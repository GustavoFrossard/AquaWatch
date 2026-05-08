"""
AquaWatch — Download Brazilian fish images from iNaturalist.

Uses the iNaturalist API to find research-grade observations of fish
in Brazil, then downloads CC-licensed photos organized by species.

This enriches the training dataset with Brazilian freshwater and
coastal species that are missing from Fish-Vista and other datasets.

Run:  python scripts/download_inaturalist.py
"""

import io
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

from PIL import Image

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
DATASETS_DIR = ROOT / "datasets"
INAT_DIR = DATASETS_DIR / "inaturalist_br"

# iNaturalist API
INAT_API = "https://api.inaturalist.org/v1"
PLACE_ID_BRAZIL = 6878
ICONIC_TAXA = "Actinopterygii"  # ray-finned fishes
QUALITY = "research"

# Target: species with most observations in Brazil
# We want at least 30 photos per species, up to 150
MIN_PHOTOS = 30
MAX_PHOTOS = 150
MIN_SPECIES_OBS = 50  # only species with >= 50 observations in Brazil

# Important Brazilian species to prioritize (scientific names)
# These will be downloaded even if slightly below the observation threshold
PRIORITY_SPECIES = [
    # Freshwater sport & food fish
    "Salminus brasiliensis",     # Dourado
    "Salminus hilarii",          # Tabarana
    "Cichla ocellaris",          # Tucunaré
    "Cichla temensis",           # Tucunaré-açu
    "Cichla kelberi",            # Tucunaré-amarelo
    "Colossoma macropomum",      # Tambaqui
    "Piaractus mesopotamicus",   # Pacu
    "Brycon hilarii",            # Piraputanga
    "Brycon orbignyanus",        # Piracanjuba
    "Pseudoplatystoma corruscans",  # Pintado
    "Pseudoplatystoma fasciatum",   # Surubim / Cachara
    "Hoplias malabaricus",       # Traíra
    "Hoplias lacerdae",          # Trairão
    "Pygocentrus nattereri",     # Piranha-vermelha
    "Serrasalmus maculatus",     # Piranha
    "Prochilodus lineatus",      # Curimbatá
    "Leporinus friderici",       # Piau
    "Geophagus brasiliensis",    # Cará / Acará
    "Astronotus ocellatus",      # Oscar / Apaiari
    "Oreochromis niloticus",     # Tilápia-do-nilo
    "Coptodon rendalli",         # Tilápia-rendalli
    "Micropterus salmoides",     # Black bass (introduzido)
    "Pterygoplichthys ambrosettii",  # Cascudo
    "Hypostomus affinis",        # Cascudo
    "Poecilia reticulata",       # Guppy / Lebiste
    "Poecilia vivipara",         # Guaru / Barrigudinho

    # Coastal / Marine
    "Abudefduf saxatilis",       # Sargento
    "Pomacanthus paru",          # Paru / Frade
    "Stegastes fuscus",          # Donzela
    "Mugil liza",                # Tainha
    "Centropomus undecimalis",   # Robalo-flecha
    "Centropomus parallelus",    # Robalo-peva
    "Cynoscion leiarchus",       # Pescada-branca
    "Epinephelus marginatus",    # Garoupa
    "Mycteroperca bonaci",       # Badejo
    "Diplodus argenteus",        # Marimbá
    "Bathygobius soporator",     # Amboré
    "Acanthurus coeruleus",      # Cirurgião-azul
    "Acanthurus chirurgus",      # Cirurgião
    "Holocentrus adscensionis",  # Jaguareçá
    "Balistes capriscus",        # Cangulo
    "Dactylopterus volitans",    # Coió / Voador

    # Amazonian
    "Arapaima gigas",            # Pirarucu
    "Osteoglossum bicirrhosum",  # Aruanã
]

HEADERS = {"User-Agent": "AquaWatch/1.0 (fish identification research)"}
MAX_THREADS = 8


def _api_get(endpoint: str, params: dict) -> dict:
    """Make a GET request to the iNaturalist API with rate limiting."""
    query = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"{INAT_API}/{endpoint}?{query}"
    req = Request(url, headers=HEADERS)

    for attempt in range(3):
        try:
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (HTTPError, URLError) as e:
            if attempt < 2:
                time.sleep(2 ** attempt)
            else:
                print(f"  API error: {e}")
                return {}


def get_top_species(min_obs: int = MIN_SPECIES_OBS, per_page: int = 200) -> list[dict]:
    """Get the most-observed fish species in Brazil."""
    print(f"Fetching top fish species in Brazil (>= {min_obs} observations)...")

    all_results = []
    page = 1
    while True:
        data = _api_get("observations/species_counts", {
            "place_id": PLACE_ID_BRAZIL,
            "iconic_taxa": ICONIC_TAXA,
            "quality_grade": QUALITY,
            "per_page": per_page,
            "page": page,
        })
        if not data or not data.get("results"):
            break

        results = data["results"]
        for r in results:
            if r["count"] >= min_obs:
                all_results.append(r)
            else:
                # Results are sorted by count desc, so we can stop
                return all_results
        page += 1
        time.sleep(1)  # rate limit

    return all_results


def get_species_observations(taxon_id: int, max_photos: int = MAX_PHOTOS) -> list[str]:
    """Get photo URLs for a species from research-grade observations in Brazil."""
    photo_urls = []
    page = 1
    per_page = 30

    while len(photo_urls) < max_photos:
        data = _api_get("observations", {
            "taxon_id": taxon_id,
            "place_id": PLACE_ID_BRAZIL,
            "quality_grade": QUALITY,
            "photos": "true",
            "photo_licensed": "true",  # only CC-licensed photos
            "per_page": per_page,
            "page": page,
            "order": "desc",
            "order_by": "votes",
        })
        if not data or not data.get("results"):
            break

        for obs in data["results"]:
            for photo in obs.get("photos", []):
                if photo.get("license_code"):  # has CC license
                    # Get medium-size URL
                    url = photo.get("url", "")
                    if url:
                        # Convert square thumbnail to medium
                        medium_url = url.replace("/square.", "/medium.")
                        photo_urls.append(medium_url)
                        if len(photo_urls) >= max_photos:
                            break
            if len(photo_urls) >= max_photos:
                break

        if len(data["results"]) < per_page:
            break
        page += 1
        time.sleep(0.5)  # rate limit

    return photo_urls[:max_photos]


def download_image(url: str, save_path: Path) -> bool:
    """Download and save an image as JPEG."""
    if save_path.exists():
        return True
    try:
        req = Request(url, headers=HEADERS)
        with urlopen(req, timeout=20) as resp:
            img_data = resp.read()
        img = Image.open(io.BytesIO(img_data))
        if img.mode != "RGB":
            img = img.convert("RGB")
        # Skip very small images
        w, h = img.size
        if w < 100 or h < 100:
            return False
        img.save(save_path, "JPEG", quality=90)
        return True
    except Exception:
        return False


def find_taxon_by_name(name: str) -> dict | None:
    """Search for a taxon by scientific name."""
    data = _api_get("taxa", {
        "q": name.replace(" ", "+"),
        "rank": "species",
        "is_active": "true",
        "per_page": 5,
    })
    if data and data.get("results"):
        for t in data["results"]:
            if t.get("name", "").lower() == name.lower():
                return t
    return None


def _sanitize_label(name: str) -> str:
    """Normalize species name to folder label."""
    return name.strip().lower().replace(" ", "_")


def main():
    print("=" * 60)
    print("AquaWatch — iNaturalist Brazilian Fish Downloader")
    print("=" * 60)

    INAT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Get top observed species in Brazil
    top_species = get_top_species()
    print(f"Found {len(top_species)} species with >= {MIN_SPECIES_OBS} obs in Brazil")

    # Build taxon map: {scientific_name: {taxon_id, count, common_name}}
    species_map = {}
    for sp in top_species:
        taxon = sp["taxon"]
        name = taxon.get("name", "")
        species_map[name] = {
            "taxon_id": taxon["id"],
            "count": sp["count"],
            "common_name": taxon.get("preferred_common_name", ""),
        }

    # 2. Add priority species that might not be in top list
    print(f"\nChecking {len(PRIORITY_SPECIES)} priority species...")
    for sp_name in PRIORITY_SPECIES:
        if sp_name not in species_map:
            taxon = find_taxon_by_name(sp_name)
            if taxon:
                species_map[sp_name] = {
                    "taxon_id": taxon["id"],
                    "count": 0,  # unknown, but we want it
                    "common_name": taxon.get("preferred_common_name", ""),
                }
                print(f"  + {sp_name} ({taxon.get('preferred_common_name', '?')})")
            else:
                print(f"  ? {sp_name} — not found on iNaturalist")
            time.sleep(0.5)

    print(f"\nTotal species to download: {len(species_map)}")

    # 3. Download photos for each species
    total_downloaded = 0
    species_stats = []

    for i, (sp_name, sp_info) in enumerate(sorted(species_map.items())):
        label = _sanitize_label(sp_name)
        sp_dir = INAT_DIR / label
        sp_dir.mkdir(parents=True, exist_ok=True)

        # Check existing
        existing = len(list(sp_dir.glob("*.jpg")))
        if existing >= MIN_PHOTOS:
            print(f"[{i+1}/{len(species_map)}] {sp_name}: already have {existing} images, skipping")
            species_stats.append((sp_name, existing))
            total_downloaded += existing
            continue

        needed = MAX_PHOTOS - existing
        print(f"[{i+1}/{len(species_map)}] {sp_name} ({sp_info['common_name']})...", end=" ", flush=True)

        # Get photo URLs
        urls = get_species_observations(sp_info["taxon_id"], max_photos=needed)
        if not urls:
            print("no CC photos found")
            continue

        # Download with threadpool
        downloaded = 0
        with ThreadPoolExecutor(max_workers=MAX_THREADS) as pool:
            futures = {}
            for j, url in enumerate(urls):
                fname = f"inat_{j + existing:04d}.jpg"
                fpath = sp_dir / fname
                futures[pool.submit(download_image, url, fpath)] = fpath

            for future in as_completed(futures):
                if future.result():
                    downloaded += 1

        total = existing + downloaded
        print(f"{downloaded} downloaded ({total} total)")
        species_stats.append((sp_name, total))
        total_downloaded += total
        time.sleep(1)  # rate limit between species

    # 4. Summary
    print(f"\n{'='*60}")
    print(f"Download complete!")
    print(f"Total images: {total_downloaded}")
    print(f"Species with >= {MIN_PHOTOS} images: {sum(1 for _, c in species_stats if c >= MIN_PHOTOS)}")

    # Save species list for reference
    stats_path = INAT_DIR / "download_stats.json"
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump({
            "total_images": total_downloaded,
            "species": {name: count for name, count in species_stats},
        }, f, ensure_ascii=False, indent=2)
    print(f"Stats saved to: {stats_path}")

    # Filter viable species
    viable = [(name, count) for name, count in species_stats if count >= MIN_PHOTOS]
    print(f"\nViable species (>= {MIN_PHOTOS} images): {len(viable)}")
    for name, count in sorted(viable, key=lambda x: -x[1])[:20]:
        print(f"  {name}: {count}")


if __name__ == "__main__":
    main()
