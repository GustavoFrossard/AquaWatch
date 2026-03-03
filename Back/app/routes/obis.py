import json
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen

from fastapi import APIRouter, HTTPException, Query

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
    common_name = (
        item.get("vernacularName")
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
