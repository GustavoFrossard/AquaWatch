import base64
import json
import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import urlopen, Request

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app import common_names as cn
from app.config import settings

router = APIRouter(prefix="/api/obis", tags=["obis"])

OBIS_OCCURRENCE_URL = "https://api.obis.org/v3/occurrence"
FISH_TAXA = "Actinopterygii,Actinopteri,Osteichthyes"
REQUEST_TIMEOUT_SECONDS = 10
RESPONSE_CACHE_TTL_SECONDS = 45
TILE_CACHE_TTL_SECONDS = 60 * 60 * 6
MAX_RETURNED_POINTS = 30000
MAX_POINTS_PER_TILE = 5000
MAX_TILE_WORKERS = 6
MAX_TILES_PER_REQUEST = 48

CACHE_DIR = Path(__file__).resolve().parents[2] / "cache" / "obis_fish_tiles_v3"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

_response_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _parse_bbox(raw_bbox: str) -> tuple[float, float, float, float]:
    parts = [p.strip() for p in raw_bbox.split(",")]
    if len(parts) != 4:
        raise HTTPException(
            status_code=400,
            detail="bbox must be minLng,minLat,maxLng,maxLat",
        )

    try:
        min_lng, min_lat, max_lng, max_lat = map(float, parts)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="bbox has invalid numbers") from exc

    min_lng = _clamp(min_lng, -180, 180)
    max_lng = _clamp(max_lng, -180, 180)
    min_lat = _clamp(min_lat, -90, 90)
    max_lat = _clamp(max_lat, -90, 90)

    if min_lng >= max_lng or min_lat >= max_lat:
        raise HTTPException(status_code=400, detail="bbox min values must be lower than max values")

    return min_lng, min_lat, max_lng, max_lat


def _response_cache_key(min_lng: float, min_lat: float, max_lng: float, max_lat: float, zoom: int) -> str:
    precision = 1 if zoom <= 5 else 2 if zoom <= 10 else 3
    return "|".join(
        [
            f"{round(min_lng, precision)}",
            f"{round(min_lat, precision)}",
            f"{round(max_lng, precision)}",
            f"{round(max_lat, precision)}",
            str(zoom),
        ]
    )


def _wkt_polygon(min_lng: float, min_lat: float, max_lng: float, max_lat: float) -> str:
    return (
        f"POLYGON(({min_lng} {min_lat},"
        f"{max_lng} {min_lat},"
        f"{max_lng} {max_lat},"
        f"{min_lng} {max_lat},"
        f"{min_lng} {min_lat}))"
    )


def _tile_bbox(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2**z
    lon_left = x / n * 360.0 - 180.0
    lon_right = (x + 1) / n * 360.0 - 180.0

    lat_top_rad = math.atan(math.sinh(math.pi * (1 - 2 * y / n)))
    lat_bottom_rad = math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n)))

    lat_top = math.degrees(lat_top_rad)
    lat_bottom = math.degrees(lat_bottom_rad)

    return lon_left, lat_bottom, lon_right, lat_top


def _lon_to_tile_x(lon: float, z: int) -> int:
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    return max(0, min(n - 1, x))


def _lat_to_tile_y(lat: float, z: int) -> int:
    n = 2**z
    lat_rad = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    return max(0, min(n - 1, y))


def _choose_tile_zoom(zoom: int, bbox_area: float) -> int:
    if zoom >= 14:
        base = 9
    elif zoom >= 11:
        base = 8
    elif zoom >= 8:
        base = 7
    else:
        base = 6

    if bbox_area > 200:
        base -= 2
    elif bbox_area > 60:
        base -= 1

    return max(4, min(9, base))


def _tiles_for_bbox(min_lng: float, min_lat: float, max_lng: float, max_lat: float, z: int) -> list[tuple[int, int, int]]:
    x_min = _lon_to_tile_x(min_lng, z)
    x_max = _lon_to_tile_x(max_lng, z)
    y_min = _lat_to_tile_y(max_lat, z)
    y_max = _lat_to_tile_y(min_lat, z)

    tiles: list[tuple[int, int, int]] = []
    for x in range(x_min, x_max + 1):
        for y in range(y_min, y_max + 1):
            tiles.append((z, x, y))
    return tiles


def _tile_cache_file(z: int, x: int, y: int) -> Path:
    return CACHE_DIR / str(z) / f"{x}_{y}.json"


def _read_tile_cache(z: int, x: int, y: int) -> list[dict[str, Any]] | None:
    file_path = _tile_cache_file(z, x, y)
    if not file_path.exists():
        return None

    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
    except Exception:
        return None

    updated_at = payload.get("updatedAt")
    points = payload.get("points")
    if not isinstance(updated_at, (int, float)) or not isinstance(points, list):
        return None

    if time.time() - float(updated_at) > TILE_CACHE_TTL_SECONDS:
        return None

    return points


def _write_tile_cache(z: int, x: int, y: int, points: list[dict[str, Any]]) -> None:
    file_path = _tile_cache_file(z, x, y)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "updatedAt": time.time(),
        "points": points,
    }
    file_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")


def _limit_for_zoom(zoom: int) -> int:
    if zoom <= 5:
        return 2500
    if zoom <= 8:
        return 4000
    if zoom <= 11:
        return 3000
    return 1800


def _pages_for_zoom(zoom: int) -> int:
    if zoom <= 5:
        return 2
    if zoom <= 8:
        return 3
    if zoom <= 11:
        return 2
    return 1


def _fetch_obis(min_lng: float, min_lat: float, max_lng: float, max_lat: float, size: int, offset: int) -> dict[str, Any]:
    query = urlencode(
        {
            "scientificname": FISH_TAXA,
            "geometry": _wkt_polygon(min_lng, min_lat, max_lng, max_lat),
            "size": str(size),
            "from": str(offset),
        }
    )
    url = f"{OBIS_OCCURRENCE_URL}?{query}"

    with urlopen(url, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload)


def _fetch_multi_page(min_lng: float, min_lat: float, max_lng: float, max_lat: float, size: int, pages: int) -> list[dict[str, Any]]:
    all_results: list[dict[str, Any]] = []

    first = _fetch_obis(min_lng, min_lat, max_lng, max_lat, size, 0)
    first_results = first.get("results", []) if isinstance(first, dict) else []
    if not first_results:
        return all_results

    all_results.extend(first_results)
    if len(first_results) < size or pages <= 1:
        return all_results

    offsets = [page * size for page in range(1, pages)]
    workers = min(4, len(offsets))

    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_map = {
            executor.submit(_fetch_obis, min_lng, min_lat, max_lng, max_lat, size, offset): offset
            for offset in offsets
        }

        chunks: list[tuple[int, list[dict[str, Any]]]] = []
        for future in as_completed(future_map):
            offset = future_map[future]
            try:
                raw = future.result()
            except Exception:
                continue

            results = raw.get("results", []) if isinstance(raw, dict) else []
            if results:
                chunks.append((offset, results))

        for _, rows in sorted(chunks, key=lambda item: item[0]):
            all_results.extend(rows)
            if len(all_results) >= MAX_RETURNED_POINTS * 2:
                break

    return all_results


def _to_point(item: dict[str, Any], fallback_idx: int) -> dict[str, Any] | None:
    lat = item.get("decimalLatitude")
    lng = item.get("decimalLongitude")
    if lat is None or lng is None:
        return None

    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except (TypeError, ValueError):
        return None

    scientific_name = item.get("scientificName") or item.get("species") or "Fish"
    # Try the Portuguese common name from our cache first,
    # then fall back to whatever OBIS provides
    common_name = (
        cn.get(scientific_name)
        or item.get("vernacularName")
        or item.get("commonName")
    )
    dataset_name = item.get("datasetName")
    institution_code = item.get("institutionCode")
    publisher = item.get("publisher")
    source_parts = [part for part in [dataset_name, institution_code or publisher] if part]
    source = " — ".join(source_parts) if source_parts else None

    return {
        "id": item.get("id") or item.get("occurrenceID") or f"{lat_f}:{lng_f}:{fallback_idx}",
        "lat": lat_f,
        "lng": lng_f,
        "commonName": common_name,
        "scientificName": scientific_name,
        "source": source,
    }


def _points_for_tile(z: int, x: int, y: int, zoom: int) -> tuple[list[dict[str, Any]], bool]:
    cached = _read_tile_cache(z, x, y)
    if cached is not None:
        return cached, True

    min_lng, min_lat, max_lng, max_lat = _tile_bbox(z, x, y)
    size = _limit_for_zoom(zoom)
    pages = _pages_for_zoom(zoom)

    try:
        rows = _fetch_multi_page(min_lng, min_lat, max_lng, max_lat, size, pages)
    except Exception:
        return [], False

    points: list[dict[str, Any]] = []
    for idx, row in enumerate(rows):
        point = _to_point(row, idx)
        if point is None:
            continue

        points.append(point)
        if len(points) >= MAX_POINTS_PER_TILE:
            break

    _write_tile_cache(z, x, y, points)

    # Queue scientific names for background Portuguese common-name resolution
    cn.queue_batch([p["scientificName"] for p in points])

    return points, False


def _render_grid_for_zoom(zoom: int) -> float:
    if zoom <= 5:
        return 0.08
    if zoom <= 8:
        return 0.04
    if zoom <= 11:
        return 0.02
    if zoom <= 13:
        return 0.01
    return 0.0


def _thin_render(points: list[dict[str, Any]], zoom: int) -> list[dict[str, Any]]:
    grid = _render_grid_for_zoom(zoom)
    if grid <= 0:
        return points[:MAX_RETURNED_POINTS]

    kept: set[tuple[int, int]] = set()
    result: list[dict[str, Any]] = []

    for point in points:
        lat_cell = math.floor(point["lat"] / grid)
        lng_cell = math.floor(point["lng"] / grid)
        cell = (lat_cell, lng_cell)
        if cell in kept:
            continue

        kept.add(cell)
        result.append(point)
        if len(result) >= MAX_RETURNED_POINTS:
            break

    return result


@router.get("/fish")
def fish_occurrences(
    bbox: str = Query(..., description="minLng,minLat,maxLng,maxLat"),
    zoom: int = Query(4, ge=1, le=18),
):
    min_lng, min_lat, max_lng, max_lat = _parse_bbox(bbox)

    cache_key = _response_cache_key(min_lng, min_lat, max_lng, max_lat, zoom)
    now = time.time()
    cached = _response_cache.get(cache_key)
    if cached and now - cached[0] < RESPONSE_CACHE_TTL_SECONDS:
        cached_response = dict(cached[1])
        cached_meta = dict(cached_response.get("meta", {}))
        cached_meta["cached"] = True
        cached_response["meta"] = cached_meta
        # Enrich cached response with any newly resolved PT names
        for point in cached_response.get("points", []):
            if not point.get("commonName"):
                pt_name = cn.get(point.get("scientificName", ""))
                if pt_name:
                    point["commonName"] = pt_name
        return cached_response

    bbox_area = (max_lng - min_lng) * (max_lat - min_lat)
    tile_zoom = _choose_tile_zoom(zoom, bbox_area)
    tiles = _tiles_for_bbox(min_lng, min_lat, max_lng, max_lat, tile_zoom)

    while len(tiles) > MAX_TILES_PER_REQUEST and tile_zoom > 4:
        tile_zoom -= 1
        tiles = _tiles_for_bbox(min_lng, min_lat, max_lng, max_lat, tile_zoom)

    tile_hits = 0
    tile_misses = 0
    merged_points: list[dict[str, Any]] = []

    workers = min(MAX_TILE_WORKERS, max(1, len(tiles)))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(_points_for_tile, z, x, y, zoom): (z, x, y)
            for (z, x, y) in tiles
        }

        for future in as_completed(futures):
            try:
                points, hit = future.result()
            except Exception:
                points, hit = [], False

            if hit:
                tile_hits += 1
            else:
                tile_misses += 1

            if points:
                merged_points.extend(points)

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for point in merged_points:
        if not (min_lng <= point["lng"] <= max_lng and min_lat <= point["lat"] <= max_lat):
            continue

        key = str(point["id"])
        if key in seen:
            continue

        seen.add(key)
        deduped.append(point)

    points = _thin_render(deduped, zoom)
    for point in points:
        point.pop("aphiaId", None)
        # Enrich with Portuguese common names from cache (even for tile-cached points)
        if not point.get("commonName"):
            pt_name = cn.get(point.get("scientificName", ""))
            if pt_name:
                point["commonName"] = pt_name

    response = {
        "points": points,
        "meta": {
            "zoom": zoom,
            "bbox": [min_lng, min_lat, max_lng, max_lat],
            "tileZoom": tile_zoom,
            "tiles": len(tiles),
            "tileCacheHits": tile_hits,
            "tileCacheMisses": tile_misses,
            "received": len(deduped),
            "returned": len(points),
            "taxa": FISH_TAXA,
            "cached": False,
        },
    }

    _response_cache[cache_key] = (now, response)
    return response


@router.get("/fish/nearby")
def fish_nearby(
    lat: float = Query(..., ge=-90, le=90, description="User latitude"),
    lng: float = Query(..., ge=-180, le=180, description="User longitude"),
    radius: int = Query(200, ge=1, le=500, description="Radius in km"),
):
    """Return fish occurrences within *radius* km of a point.

    Converts the radius to a bounding box, fetches tiles, then filters
    points by haversine distance so only those truly inside the circle
    are returned.
    """
    # ~1 degree latitude ≈ 111 km
    dlat = radius / 111.0
    # longitude degrees shrink with cos(lat)
    dlng = radius / (111.0 * max(math.cos(math.radians(lat)), 0.01))

    min_lat_bb = _clamp(lat - dlat, -90, 90)
    max_lat_bb = _clamp(lat + dlat, -90, 90)
    min_lng_bb = _clamp(lng - dlng, -180, 180)
    max_lng_bb = _clamp(lng + dlng, -180, 180)

    # Pick a reasonable tile zoom for a ~200 km box
    bbox_area = (max_lng_bb - min_lng_bb) * (max_lat_bb - min_lat_bb)
    tile_zoom = _choose_tile_zoom(7, bbox_area)  # zoom 7 is a good default for 200km
    tiles = _tiles_for_bbox(min_lng_bb, min_lat_bb, max_lng_bb, max_lat_bb, tile_zoom)

    while len(tiles) > MAX_TILES_PER_REQUEST and tile_zoom > 4:
        tile_zoom -= 1
        tiles = _tiles_for_bbox(min_lng_bb, min_lat_bb, max_lng_bb, max_lat_bb, tile_zoom)

    # Check response cache
    cache_key = f"nearby|{round(lat, 2)}|{round(lng, 2)}|{radius}"
    now = time.time()
    cached = _response_cache.get(cache_key)
    if cached and now - cached[0] < RESPONSE_CACHE_TTL_SECONDS:
        cached_response = dict(cached[1])
        cached_meta = dict(cached_response.get("meta", {}))
        cached_meta["cached"] = True
        cached_response["meta"] = cached_meta
        for point in cached_response.get("points", []):
            if not point.get("commonName"):
                pt_name = cn.get(point.get("scientificName", ""))
                if pt_name:
                    point["commonName"] = pt_name
        return cached_response

    tile_hits = 0
    tile_misses = 0
    merged_points: list[dict[str, Any]] = []

    workers = min(MAX_TILE_WORKERS, max(1, len(tiles)))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(_points_for_tile, z, x, y, 7): (z, x, y)
            for (z, x, y) in tiles
        }
        for future in as_completed(futures):
            try:
                points, hit = future.result()
            except Exception:
                points, hit = [], False
            if hit:
                tile_hits += 1
            else:
                tile_misses += 1
            if points:
                merged_points.extend(points)

    # Deduplicate
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for point in merged_points:
        key = str(point["id"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(point)

    # Filter by actual haversine distance
    radius_m = radius * 1000.0
    filtered: list[dict[str, Any]] = []
    for point in deduped:
        if _haversine_m(lat, lng, point["lat"], point["lng"]) <= radius_m:
            filtered.append(point)

    # Thin for rendering
    points = _thin_render(filtered, 7)

    for point in points:
        point.pop("aphiaId", None)
        if not point.get("commonName"):
            pt_name = cn.get(point.get("scientificName", ""))
            if pt_name:
                point["commonName"] = pt_name

    response = {
        "points": points,
        "meta": {
            "lat": lat,
            "lng": lng,
            "radiusKm": radius,
            "tileZoom": tile_zoom,
            "tiles": len(tiles),
            "tileCacheHits": tile_hits,
            "tileCacheMisses": tile_misses,
            "received": len(filtered),
            "returned": len(points),
            "taxa": FISH_TAXA,
            "cached": False,
        },
    }

    _response_cache[cache_key] = (now, response)
    return response


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in **metres** between two points."""
    R = 6_371_000  # Earth radius in metres
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


@router.get("/common-names/stats")
def common_name_stats():
    """Return stats about the Portuguese common-name cache."""
    return cn.stats()


# ---------------------------------------------------------------------------
# Species detail cache (in-memory, TTL 1 hour)
# ---------------------------------------------------------------------------
_species_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_SPECIES_TTL = 60 * 60  # 1 hour

import logging as _logging
_sp_log = _logging.getLogger("species_detail")


def _worms_image(scientific_name: str) -> str | None:
    """Get species image URL from WoRMS via AphiaID → image endpoint."""
    try:
        aphia_url = f"https://www.marinespecies.org/rest/AphiaIDByName/{quote(scientific_name)}?marine_only=true"
        with urlopen(aphia_url, timeout=5) as resp:
            aphia_id = int(resp.read().decode("utf-8").strip())
            if aphia_id <= 0:
                return None
    except Exception as e:
        _sp_log.debug("WoRMS AphiaID failed for %s: %s", scientific_name, e)
        return None

    try:
        img_url = f"https://www.marinespecies.org/rest/AphiaImagesByAphiaID/{aphia_id}"
        with urlopen(img_url, timeout=5) as resp:
            images = json.loads(resp.read().decode("utf-8"))
            if isinstance(images, list) and images:
                url = images[0].get("url") or images[0].get("good_image")
                if url:
                    _sp_log.debug("WoRMS image found for %s", scientific_name)
                return url
    except Exception as e:
        _sp_log.debug("WoRMS image failed for %s: %s", scientific_name, e)
    return None


def _inaturalist_image(scientific_name: str) -> str | None:
    """Get species image from iNaturalist (fallback)."""
    try:
        url = f"https://api.inaturalist.org/v1/taxa?q={quote(scientific_name)}&per_page=1"
        with urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            results = data.get("results", [])
            if results:
                photo = results[0].get("default_photo")
                if photo:
                    img = photo.get("medium_url") or photo.get("square_url")
                    if img:
                        _sp_log.debug("iNaturalist image found for %s", scientific_name)
                    return img
    except Exception as e:
        _sp_log.debug("iNaturalist failed for %s: %s", scientific_name, e)
    return None


def _get_image(scientific_name: str) -> str | None:
    """Try WoRMS then iNaturalist for species image."""
    return _worms_image(scientific_name) or _inaturalist_image(scientific_name)


def _gemini_species_info(scientific_name: str, common_name: str | None) -> dict[str, Any]:
    """Get species description and conservation info from Gemini."""
    api_key = settings.gemini_api_key
    if not api_key:
        _sp_log.warning("No Gemini API key")
        return {}

    display_name = common_name or scientific_name

    prompt = (
        f"Forneça informações sobre o peixe {scientific_name}"
        f"{f' ({display_name})' if common_name else ''}. "
        "Responda SOMENTE com um JSON válido com estes campos:\n"
        '{\n'
        '  "nomeComum": "nome popular em português brasileiro (ou null se desconhecido)",\n'
        '  "descricao": "descrição geral de 2-3 frases em português brasileiro",\n'
        '  "tamanho": "tamanho médio/máximo (ex: 30-60 cm)",\n'
        '  "habitat": "onde vive (ex: Recifes de coral e costões rochosos)",\n'
        '  "alimentacao": "do que se alimenta, frase curta",\n'
        '  "conservacao": "status IUCN (Pouco preocupante / Vulnerável / Em perigo / Criticamente em perigo / Dados insuficientes)",\n'
        '  "conservacao_detalhe": "ameaças, pesca e situação no Brasil, 2-3 frases",\n'
        '  "curiosidade": "fato interessante, 1-2 frases"\n'
        '}\n'
        "Sem explicações, sem markdown, apenas o JSON."
    )

    # Try multiple models — fastest first, then fallbacks
    _MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"]

    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json",
        },
    }).encode("utf-8")

    for model in _MODELS:
        model_url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={api_key}"
        )
        for attempt in range(2):
            req = Request(
                model_url, data=payload,
                headers={"Content-Type": "application/json"}, method="POST",
            )
            try:
                with urlopen(req, timeout=20) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                text = data["candidates"][0]["content"]["parts"][0]["text"]
                text = text.strip()
                if text.startswith("```"):
                    text = text.split("\n", 1)[-1]
                    if text.endswith("```"):
                        text = text[:-3]
                    text = text.strip()
                result = json.loads(text)
                _sp_log.info("Gemini [%s] info OK for %s (%d fields)", model, scientific_name, len(result))
                return result
            except HTTPError as e:
                _sp_log.warning("Gemini [%s] HTTP %d for %s (attempt %d)", model, e.code, scientific_name, attempt + 1)
                if e.code == 429:
                    if attempt == 0:
                        time.sleep(5)
                        continue
                    break  # try next model
                break
            except Exception as e:
                _sp_log.warning("Gemini [%s] error for %s (attempt %d): %s", model, scientific_name, attempt + 1, e)
                if attempt == 0:
                    time.sleep(2)
                    continue
                break

    return {}


@router.get("/species/{scientific_name:path}")
def species_detail(scientific_name: str):
    """
    Full species detail: photo, names, description, conservation.
    Runs image fetch and Gemini info in PARALLEL for speed.
    Results cached for 1 hour.
    """
    key = scientific_name.lower().strip()
    now = time.time()

    cached = _species_cache.get(key)
    if cached and now - cached[0] < _SPECIES_TTL:
        return cached[1]

    common_name = cn.get(scientific_name)

    _sp_log.info("Fetching species detail for %s …", scientific_name)
    t0 = time.time()

    # Run image and Gemini lookups in PARALLEL
    image_url = None
    info = {}

    with ThreadPoolExecutor(max_workers=2) as pool:
        img_future = pool.submit(_get_image, scientific_name)
        info_future = pool.submit(_gemini_species_info, scientific_name, common_name)

        try:
            image_url = img_future.result(timeout=12)
        except Exception:
            image_url = None

        try:
            info = info_future.result(timeout=22)
        except Exception:
            info = {}

    elapsed = time.time() - t0
    _sp_log.info("Species detail for %s done in %.1fs (image=%s, fields=%d)",
                 scientific_name, elapsed, bool(image_url), len(info))

    result = {
        "scientificName": scientific_name,
        "commonName": common_name,
        "imageUrl": image_url,
        "descricao": info.get("descricao"),
        "tamanho": info.get("tamanho"),
        "habitat": info.get("habitat"),
        "alimentacao": info.get("alimentacao"),
        "conservacao": info.get("conservacao"),
        "conservacao_detalhe": info.get("conservacao_detalhe"),
        "curiosidade": info.get("curiosidade"),
    }

    # Only cache for the full TTL when Gemini actually returned data.
    # For failed/empty responses, use a short TTL (2 min) so retries happen soon.
    has_gemini_data = bool(info)
    ttl = _SPECIES_TTL if has_gemini_data else 120
    _species_cache[key] = (now + ttl - _SPECIES_TTL, result)
    return result


# ---------------------------------------------------------------------------
# Fish identification — Gemini Vision (primary) + local model (fallback)
# ---------------------------------------------------------------------------
_id_log = logging.getLogger("aquawatch.identify")

_IDENTIFY_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"]

# Try to load the local trained model
_local_model_available = False
try:
    import sys as _sys
    _model_dir = str(Path(__file__).resolve().parent.parent.parent.parent / "Model")
    if _model_dir not in _sys.path:
        _sys.path.insert(0, _model_dir)
    from inference import identify as _local_identify, is_model_available as _is_model_available
    _local_model_available = _is_model_available()
    if _local_model_available:
        _id_log.info("Local fish model available — will use as primary identifier")
    else:
        _id_log.info("Local model files not found — using Gemini as primary")
except ImportError:
    _id_log.info("Local model module not found — using Gemini only")


class IdentifyRequest(BaseModel):
    image: str  # base64 data-URI or raw base64


def _strip_data_uri(data_uri: str) -> tuple[str, str]:
    """Return (mime_type, raw_base64) from a data URI or plain base64."""
    if data_uri.startswith("data:"):
        header, b64 = data_uri.split(",", 1)
        mime = header.split(":")[1].split(";")[0]
        return mime, b64
    return "image/jpeg", data_uri


def _identify_with_local_model(image_b64: str) -> dict | None:
    """Try to identify using the local trained model, then enrich with Gemini text API."""
    if not _local_model_available:
        return None
    try:
        result = _local_identify(image_b64)
        if result and not result.get("erro"):
            scientific = result.get("nomeCientifico", "")
            confidence = result.get("_model_confidence", 0)
            _id_log.info("Identified via [local model]: %s (%.1f%%)", scientific, confidence * 100)

            # Enrich with Gemini text API (cheap, no image, rarely rate-limited)
            enrichment = _gemini_species_info(scientific, result.get("nomeComum") or None)
            if enrichment:
                _id_log.info("Enriched local result with Gemini text data")
                for key in ("descricao", "tamanho", "habitat", "alimentacao",
                            "conservacao", "conservacao_detalhe", "curiosidade"):
                    if enrichment.get(key) and not result.get(key):
                        result[key] = enrichment[key]
                # Gemini text may also provide a common name
                if enrichment.get("nomeComum") and not result.get("nomeComum"):
                    result["nomeComum"] = enrichment["nomeComum"]

            return result
        return None
    except Exception as e:
        _id_log.warning("Local model error: %s", e)
        return None


def _identify_with_gemini(image_b64: str) -> dict | None:
    """Try to identify using Gemini Vision API. Returns None on total failure."""
    api_key = settings.gemini_api_key
    if not api_key:
        return None

    mime_type, b64_data = _strip_data_uri(image_b64)

    prompt = (
        "Analise esta foto de peixe e identifique a espécie. "
        "Responda SOMENTE com um JSON válido com estes campos:\n"
        '{\n'
        '  "nomeCientifico": "nome científico da espécie",\n'
        '  "nomeComum": "nome popular em português brasileiro (ou null se desconhecido)",\n'
        '  "descricao": "descrição geral de 2-3 frases em português brasileiro",\n'
        '  "tamanho": "tamanho médio/máximo (ex: 30-60 cm)",\n'
        '  "habitat": "onde vive (ex: Recifes de coral e costões rochosos)",\n'
        '  "alimentacao": "do que se alimenta, frase curta",\n'
        '  "conservacao": "status IUCN (Pouco preocupante / Vulnerável / Em perigo / Criticamente em perigo / Dados insuficientes)",\n'
        '  "conservacao_detalhe": "ameaças e situação no Brasil, 2-3 frases",\n'
        '  "curiosidade": "fato interessante, 1-2 frases",\n'
        '  "confianca": "alta / media / baixa (o quanto tem certeza da identificação)"\n'
        '}\n'
        "Se não for um peixe ou não conseguir identificar, retorne "
        '{"erro": "descrição do problema"}.\n'
        "Sem explicações, sem markdown, apenas o JSON."
    )

    payload = json.dumps({
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": mime_type, "data": b64_data}},
            ],
        }],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json",
        },
    }).encode("utf-8")

    t0 = time.time()
    for model in _IDENTIFY_MODELS:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={api_key}"
        )
        for attempt in range(2):
            req = Request(url, data=payload,
                          headers={"Content-Type": "application/json"}, method="POST")
            try:
                with urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                text = data["candidates"][0]["content"]["parts"][0]["text"]
                text = text.strip()
                if text.startswith("```"):
                    text = text.split("\n", 1)[-1]
                    if text.endswith("```"):
                        text = text[:-3]
                    text = text.strip()
                result = json.loads(text)
                elapsed = time.time() - t0
                _id_log.info("Identified via [%s] in %.1fs: %s",
                             model, elapsed, result.get("nomeCientifico", "?"))
                return result
            except HTTPError as e:
                _id_log.warning("Identify [%s] HTTP %d (attempt %d)", model, e.code, attempt + 1)
                if e.code == 429:
                    if attempt == 0:
                        time.sleep(3)
                        continue
                    break
                break
            except Exception as e:
                _id_log.warning("Identify [%s] error (attempt %d): %s", model, attempt + 1, e)
                if attempt == 0:
                    time.sleep(2)
                    continue
                break
    return None


@router.post("/identify")
def identify_fish(body: IdentifyRequest):
    """
    Identify a fish from a photo. Strategy:
      1. Try Gemini Vision API (best for real-world photos)
      2. Fallback to local trained model (no rate limits, works on specimen-style photos)
      3. If both fail, return 503
    """
    # 1. Gemini (primary — best accuracy on real-world user photos)
    result = _identify_with_gemini(body.image)
    if result:
        return result

    # 2. Local model fallback (works when Gemini is rate-limited)
    result = _identify_with_local_model(body.image)
    if result:
        return result

    # 3. Both failed
    raise HTTPException(503, "Não foi possível identificar o peixe no momento. Tente novamente.")
