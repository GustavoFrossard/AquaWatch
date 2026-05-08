"""
AquaWatch — Download and prepare fish identification datasets.

Combines multiple public datasets into a unified structure:
  datasets/unified/
    train/<species_label>/img001.jpg ...
    val/<species_label>/img001.jpg ...

Supported datasets:
  1. Fish-Vista     (HuggingFace — ~73k images, ~1900 species)
  2. LSFD / NA-Fish (Kaggle crowww — ~9k images, 9 species, already cached)
  3. FishNet        (Kaggle — ~94k images, ~508 species)
  4. Fish4Knowledge (Kaggle — ~27k images, ~23 species)

Run:  python scripts/download_datasets.py
"""

import hashlib
import json
import os
import random
import shutil
import sys
from pathlib import Path
from collections import defaultdict
from PIL import Image

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
DATASETS_DIR = ROOT / "datasets"
UNIFIED_DIR = DATASETS_DIR / "unified"
TRAIN_DIR = UNIFIED_DIR / "train"
VAL_DIR = UNIFIED_DIR / "val"
LABEL_MAP_PATH = UNIFIED_DIR / "label_map.json"

MIN_IMAGES_PER_CLASS = 15   # skip species with fewer images
MAX_IMAGES_PER_CLASS = 300  # cap to reduce imbalance
VAL_RATIO = 0.15
SEED = 42

# Non-fish or junk labels to exclude
EXCLUDE_LABELS = {
    "shrimp", "crab", "lobster", "squid", "octopus", "jellyfish",
    "starfish", "seahorse", "turtle", "whale", "dolphin", "seal",
    "unknown", "background", "empty", "gobiidae",  # family-level, not species
}

random.seed(SEED)

# Image extensions to look for
IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}


def _is_image(p: Path) -> bool:
    return p.suffix.lower() in IMG_EXTS


def _sanitize_label(name: str) -> str:
    """Normalize a species folder name into a clean label."""
    name = name.strip().replace(" ", "_").replace("/", "_").replace("\\", "_")
    name = "".join(c for c in name if c.isalnum() or c in ("_", "-"))
    return name.lower()


def _short_hash(path: Path) -> str:
    return hashlib.md5(str(path).encode()).hexdigest()[:8]


def _find_class_folders(root: Path) -> dict[str, list[Path]]:
    """
    Recursively find all directories that directly contain images.
    Returns {sanitized_label: [image_paths]}.
    """
    result: dict[str, list[Path]] = defaultdict(list)
    if not root.exists():
        return result

    skip_names = {"", "gt", "readme", "annotations", "masks", "segmentation",
                  "ground_truth", "groundtruth", "test", "metadata"}

    # Label normalization: fix known typos and merge duplicates
    LABEL_FIXES = {
        "hourse_mackerel": "horse_mackerel",
        "gilt_head_bream": "gilt-head_bream",
    }

    for dirpath, dirnames, filenames in os.walk(root):
        dp = Path(dirpath)
        imgs = [dp / f for f in filenames if (dp / f).suffix.lower() in IMG_EXTS]
        if imgs:
            label = _sanitize_label(dp.name)
            if label in skip_names:
                continue
            # Skip ground-truth / mask folders (usually end with _gt)
            if label.endswith("_gt"):
                continue
            # Apply label fixes
            label = LABEL_FIXES.get(label, label)
            result[label].extend(imgs)

    return dict(result)


# ---------------------------------------------------------------------------
# 1. Fish-Vista  (Hugging Face — ~40k images, ~1758 species)
# ---------------------------------------------------------------------------
def download_fishvista() -> dict[str, list[Path]]:
    """Download Fish-Vista from Hugging Face using streaming + multithreaded image download."""
    staging = DATASETS_DIR / "fishvista_raw"

    # Check if already processed
    existing = _find_class_folders(staging)
    if existing:
        total = sum(len(v) for v in existing.values())
        print(f"[Fish-Vista] Already have {total} images in {len(existing)} classes, skipping download.")
        return existing

    print("[Fish-Vista] Downloading from Hugging Face (~40k images, ~1758 species)...")

    try:
        from datasets import load_dataset
        ds = load_dataset("imageomics/fish-vista", "species_classification",
                          split="train", streaming=True)
    except Exception as e:
        print(f"[Fish-Vista] Failed: {e}")
        return {}

    staging.mkdir(parents=True, exist_ok=True)

    from urllib.request import urlopen as _urlopen, Request as _Request
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import io
    import threading

    HF_BASE = "https://huggingface.co/datasets/imageomics/fish-vista/resolve/main/"

    result: dict[str, list[Path]] = defaultdict(list)
    result_lock = threading.Lock()
    count = 0
    errors = 0

    def _download_one(species: str, file_name: str, idx: int):
        """Download a single image. Returns (label, path) or None."""
        label = _sanitize_label(species)
        if not label:
            return None

        cls_dir = staging / label
        cls_dir.mkdir(parents=True, exist_ok=True)
        fname = f"{idx:06d}_{Path(file_name).stem}.jpg"
        fpath = cls_dir / fname

        if fpath.exists():
            return (label, fpath)

        try:
            img_url = HF_BASE + file_name.replace(" ", "%20")
            req = _Request(img_url, headers={"User-Agent": "AquaWatch/1.0"})
            with _urlopen(req, timeout=20) as resp:
                img_data = resp.read()
            img = Image.open(io.BytesIO(img_data))
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.save(fpath, "JPEG", quality=90)
            return (label, fpath)
        except Exception:
            return None

    # Collect tasks from streaming dataset
    tasks = []
    print("  Scanning dataset metadata...")
    for idx, row in enumerate(ds):
        species = row.get("standardized_species", "")
        file_name = row.get("file_name", "")
        if species and file_name:
            tasks.append((species, file_name, idx))

    print(f"  Found {len(tasks)} images to download. Starting with 12 threads...")

    # Download with threadpool
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {pool.submit(_download_one, sp, fn, i): i for sp, fn, i in tasks}
        done = 0
        for future in as_completed(futures):
            done += 1
            res = future.result()
            if res:
                label, fpath = res
                with result_lock:
                    result[label].append(fpath)
                    count += 1
            else:
                errors += 1

            if done % 2000 == 0:
                print(f"  … {done}/{len(tasks)} processed ({count} ok, {errors} errors, {len(result)} species)")

    total = sum(len(v) for v in result.values())
    print(f"[Fish-Vista] Done — {total} images in {len(result)} classes ({errors} errors)")
    return dict(result)


# ---------------------------------------------------------------------------
# 2. LSFD / NA-Fish (Kaggle crowww — already cached from previous download)
# ---------------------------------------------------------------------------
def download_lsfd() -> dict[str, list[Path]]:
    """Use the already-downloaded Large Scale Fish Dataset."""
    print("[LSFD/NA-Fish] Looking for data...")

    # Try kagglehub
    src = None
    try:
        import kagglehub
        path = kagglehub.dataset_download("crowww/a-large-scale-fish-dataset")
        src = Path(path)
    except Exception as e:
        print(f"[LSFD] kagglehub: {e}")
        # Try cache
        cache_base = Path.home() / ".cache" / "kagglehub" / "datasets" / "crowww" / "a-large-scale-fish-dataset"
        versions = sorted(cache_base.glob("versions/*")) if cache_base.exists() else []
        if versions:
            src = versions[-1]
            print(f"[LSFD] Found in cache: {src}")

    if src is None:
        print("[LSFD] No data found.")
        return {}

    result = _find_class_folders(src)
    total = sum(len(v) for v in result.values())
    print(f"[LSFD] Found {total} images in {len(result)} classes")
    return result


# ---------------------------------------------------------------------------
# 3. FishNet (Kaggle — ~94k images, ~508 species)
# ---------------------------------------------------------------------------
def download_fishnet() -> dict[str, list[Path]]:
    """Download FishNet dataset from Kaggle."""
    print("[FishNet] Downloading from Kaggle...")

    sources = [
        "markdaniellampa/fishnet-open-image-database",
        "kumarankit9891/fishnet-150",
    ]

    for slug in sources:
        try:
            import kagglehub
            path = kagglehub.dataset_download(slug)
            src = Path(path)
            result = _find_class_folders(src)
            total = sum(len(v) for v in result.values())
            if total > 0:
                print(f"[FishNet] Found {total} images in {len(result)} classes (from {slug})")
                return result
        except Exception as e:
            print(f"[FishNet] {slug} failed: {e}")

    print("[FishNet] Could not download — will continue without it.")
    return {}


# ---------------------------------------------------------------------------
# 4. Fish4Knowledge (Kaggle — ~27k images, ~23 species)
# ---------------------------------------------------------------------------
def download_fish4knowledge() -> dict[str, list[Path]]:
    """Download Fish4Knowledge from Kaggle."""
    print("[Fish4Knowledge] Downloading from Kaggle...")

    sources = [
        "sripaadsrinivasan/fish4knowledge",
        "duttadebadri/fish4knowledge-image-dataset",
    ]

    for slug in sources:
        try:
            import kagglehub
            path = kagglehub.dataset_download(slug)
            src = Path(path)
            result = _find_class_folders(src)
            total = sum(len(v) for v in result.values())
            if total > 0:
                print(f"[Fish4Knowledge] Found {total} images in {len(result)} classes (from {slug})")
                return result
        except Exception as e:
            print(f"[Fish4Knowledge] {slug} failed: {e}")

    print("[Fish4Knowledge] Could not download — will continue without it.")
    return {}


# ---------------------------------------------------------------------------
# Unify into train / val
# ---------------------------------------------------------------------------
def unify_datasets(all_class_images: list[dict[str, list[Path]]]):
    """Merge all dataset dicts into a single train/val split."""
    print("\n" + "=" * 60)
    print("Unifying all datasets...")
    print("=" * 60)

    # Merge all classes
    merged: dict[str, list[Path]] = defaultdict(list)
    for ds_classes in all_class_images:
        for label, images in ds_classes.items():
            merged[label].extend(images)

    # Remove duplicates per class (by file hash)
    for label in merged:
        seen = set()
        unique = []
        for img in merged[label]:
            h = _short_hash(img)
            if h not in seen:
                seen.add(h)
                unique.append(img)
        merged[label] = unique

    # Filter out tiny classes and excluded labels
    filtered = {
        k: v for k, v in merged.items()
        if len(v) >= MIN_IMAGES_PER_CLASS and k not in EXCLUDE_LABELS
    }

    # Cap large classes to reduce imbalance
    for label in filtered:
        if len(filtered[label]) > MAX_IMAGES_PER_CLASS:
            random.shuffle(filtered[label])
            filtered[label] = filtered[label][:MAX_IMAGES_PER_CLASS]

    print(f"Total species/classes with >= {MIN_IMAGES_PER_CLASS} images: {len(filtered)}")
    total_imgs = sum(len(v) for v in filtered.values())
    print(f"Total images: {total_imgs}")

    if total_imgs == 0:
        print("ERROR: No images found. Check dataset downloads above.")
        return

    # Stats
    sizes = sorted([len(v) for v in filtered.values()], reverse=True)
    print(f"Largest class: {sizes[0]} images")
    print(f"Smallest class: {sizes[-1]} images")
    print(f"Median class: {sizes[len(sizes)//2]} images")

    # Clean previous unified
    if UNIFIED_DIR.exists():
        shutil.rmtree(UNIFIED_DIR)
    TRAIN_DIR.mkdir(parents=True)
    VAL_DIR.mkdir(parents=True)

    # Stable numeric label mapping
    labels_sorted = sorted(filtered.keys())
    label_map = {name: idx for idx, name in enumerate(labels_sorted)}

    train_count = val_count = 0
    for label, images in filtered.items():
        random.shuffle(images)
        split = max(1, int(len(images) * VAL_RATIO))
        val_imgs = images[:split]
        train_imgs = images[split:]

        for img in train_imgs:
            dst = TRAIN_DIR / label
            dst.mkdir(parents=True, exist_ok=True)
            dest_name = f"{_short_hash(img)}_{img.stem}.jpg"
            dest_path = dst / dest_name
            try:
                if img.suffix.lower() in (".jpg", ".jpeg"):
                    shutil.copy2(img, dest_path)
                else:
                    Image.open(img).convert("RGB").save(dest_path, "JPEG", quality=92)
                train_count += 1
            except Exception:
                pass

        for img in val_imgs:
            dst = VAL_DIR / label
            dst.mkdir(parents=True, exist_ok=True)
            dest_name = f"{_short_hash(img)}_{img.stem}.jpg"
            dest_path = dst / dest_name
            try:
                if img.suffix.lower() in (".jpg", ".jpeg"):
                    shutil.copy2(img, dest_path)
                else:
                    Image.open(img).convert("RGB").save(dest_path, "JPEG", quality=92)
                val_count += 1
            except Exception:
                pass

    # Save label map
    with open(LABEL_MAP_PATH, "w", encoding="utf-8") as f:
        json.dump({
            "idx_to_label": {v: k for k, v in label_map.items()},
            "label_to_idx": label_map,
            "num_classes": len(label_map),
        }, f, ensure_ascii=False, indent=2)

    print(f"\nUnified dataset ready:")
    print(f"  Train: {train_count} images")
    print(f"  Val:   {val_count} images")
    print(f"  Classes: {len(label_map)}")
    print(f"  Label map: {LABEL_MAP_PATH}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("=" * 60)
    print("AquaWatch — Fish Dataset Downloader & Unifier v2")
    print("=" * 60)

    all_classes = []

    # Download each dataset — each returns {label: [paths]}
    all_classes.append(download_fishvista())
    all_classes.append(download_lsfd())
    all_classes.append(download_fishnet())
    all_classes.append(download_fish4knowledge())

    # Include iNaturalist Brazilian fish (must run download_inaturalist.py first)
    inat_dir = DATASETS_DIR / "inaturalist_br"
    if inat_dir.exists():
        inat_classes = _find_class_folders(inat_dir)
        total = sum(len(v) for v in inat_classes.values())
        print(f"[iNaturalist-BR] Found {total} images in {len(inat_classes)} classes")
        all_classes.append(inat_classes)
    else:
        print("[iNaturalist-BR] Not found. Run `python scripts/download_inaturalist.py` to add Brazilian species.")

    # Merge into unified train/val
    unify_datasets(all_classes)

    print("\n All done. Next step: python scripts/train.py")


if __name__ == "__main__":
    main()
