"""
Resolve Portuguese (PT-BR) common names for fish species using Gemini AI.

Strategy (fast to slow):
  1. In-memory cache  → instant
  2. Disk cache       → ~1 ms
  3. Gemini API       → ~2-5 s per batch (background, never blocks HTTP)

Key design decisions:
  • Batches of up to 50 names per Gemini call (sweet spot for speed/reliability).
  • On API error (timeout, 429, etc.) names are **NOT** cached as None — they
    stay pending and are retried on the next cycle.
  • Only names that Gemini explicitly returns null for are cached as None.
  • The background thread keeps looping until ALL pending names are processed.
"""

import json
import logging
import time
import threading
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.request import urlopen, Request

from app.config import settings

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
CACHE_FILE = Path(__file__).resolve().parents[1] / "cache" / "common_name_cache_pt.json"

# ---------------------------------------------------------------------------
# In-memory cache:  scientific_name (lower) → Portuguese common name | None
# None means "Gemini confirmed: no PT name for this species"
# ---------------------------------------------------------------------------
_lock = threading.Lock()
_cache: dict[str, str | None] = {}
_pending: set[str] = set()
_bg_running = False

NAMES_PER_BATCH = 50          # names per Gemini call
GEMINI_TIMEOUT = 30           # seconds — generous for large batches
RETRY_DELAY = 12              # seconds to wait on 429
MAX_RETRIES = 2

# ---------------------------------------------------------------------------
# Disk persistence
# ---------------------------------------------------------------------------

def _load_cache() -> None:
    global _cache
    if not CACHE_FILE.exists():
        _cache = {}
        return
    try:
        raw = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        _cache = {k.lower(): v for k, v in raw.items()}
        log.info("Loaded %d PT common-name entries from disk cache", len(_cache))
    except Exception as exc:
        log.warning("Failed to load common-name cache: %s", exc)
        _cache = {}


def _save_cache() -> None:
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(
            json.dumps(_cache, ensure_ascii=False, indent=None, separators=(",", ":")),
            encoding="utf-8",
        )
    except Exception as exc:
        log.warning("Failed to save common-name cache: %s", exc)


# ---------------------------------------------------------------------------
# Gemini batch lookup
# ---------------------------------------------------------------------------

_GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"]

_GEMINI_URL_TPL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "{model}:generateContent?key={key}"
)

_PROMPT_TEMPLATE = (
    "Você é um biólogo marinho especialista em ictiologia brasileira. "
    "Para cada nome científico de peixe abaixo, forneça o nome popular "
    "mais usado no Brasil (português brasileiro). "
    "Responda SOMENTE com um JSON válido no formato "
    '{{\"NomeCientifico\": \"nome popular\" ou null}}. '
    "Sem explicações, sem markdown, apenas o JSON.\n\n"
    "Nomes científicos:\n{names}"
)


def _gemini_call(names: list[str]) -> dict[str, str | None] | None:
    """
    Single Gemini API call for a batch of names.

    Returns:
      dict  → successful result (may contain None values for unknown species)
      None  → API error (timeout, 429, network) — caller should retry these names
    """
    api_key = settings.gemini_api_key
    if not api_key:
        log.warning("GEMINI_API_KEY not configured")
        return None

    names_text = "\n".join(f"- {n}" for n in names)
    prompt = _PROMPT_TEMPLATE.format(names=names_text)

    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
        },
    }).encode("utf-8")

    # --- HTTP call with retry on 429, trying multiple models ---
    data: dict[str, Any] | None = None
    for model in _GEMINI_MODELS:
        url = _GEMINI_URL_TPL.format(model=model, key=api_key)
        for attempt in range(MAX_RETRIES + 1):
            req = Request(
                url, data=payload,
                headers={"Content-Type": "application/json"}, method="POST",
            )
            try:
                with urlopen(req, timeout=GEMINI_TIMEOUT) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                break  # success — exit inner loop
            except HTTPError as exc:
                if exc.code == 429 and attempt < MAX_RETRIES:
                    log.warning("Gemini [%s] 429 — retry %d in %ds…", model, attempt + 1, RETRY_DELAY)
                    time.sleep(RETRY_DELAY)
                    continue
                if exc.code == 429:
                    log.warning("Gemini [%s] 429 exhausted — trying next model", model)
                    break  # try next model
                log.error("Gemini [%s] HTTP %d (attempt %d/%d)", model, exc.code, attempt + 1, MAX_RETRIES + 1)
                return None
            except Exception as exc:
                log.error("Gemini [%s] API error (attempt %d/%d): %s", model, attempt + 1, MAX_RETRIES + 1, exc)
                if attempt < MAX_RETRIES:
                    time.sleep(5)
                    continue
                return None
        # If we got data, stop trying more models
        if data is not None:
            break

    if data is None:
        return None

    # --- Parse response ---
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        log.error("Unexpected Gemini response: %s", json.dumps(data)[:500])
        return None

    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    try:
        result: dict[str, str | None] = json.loads(text)
    except json.JSONDecodeError:
        log.error("Failed to parse Gemini JSON: %s", text[:500])
        return None

    # Normalise
    out: dict[str, str | None] = {}
    for n in names:
        val = result.get(n)
        if isinstance(val, str) and val.strip():
            out[n] = val.strip()
        else:
            out[n] = None
    return out


# ---------------------------------------------------------------------------
# Background resolution — processes ALL pending in a loop
# ---------------------------------------------------------------------------

def _bg_resolve() -> None:
    """Drain the pending queue, batch by batch."""
    global _bg_running

    while True:
        # Grab next batch
        with _lock:
            if not _pending:
                _bg_running = False
                return
            batch = list(_pending)[:NAMES_PER_BATCH]
            _pending.difference_update(batch)

        log.info("BG: resolving %d names (%d still pending)…", len(batch), len(_pending))

        result = _gemini_call(batch)

        if result is None:
            # API failed — put names back so they'll be retried next cycle
            log.warning("BG: batch failed — %d names returned to pending", len(batch))
            with _lock:
                _pending.update(batch)
                _bg_running = False
            # Don't spin-loop on persistent errors
            return

        resolved = 0
        with _lock:
            for name, pt_name in result.items():
                _cache[name.lower()] = pt_name
                if pt_name:
                    resolved += 1
            _save_cache()

        log.info("BG: resolved %d / %d names", resolved, len(batch))

        # Small pause between batches to respect rate limits
        if _pending:
            time.sleep(1)


def _ensure_bg_running() -> None:
    global _bg_running
    with _lock:
        if _bg_running or not _pending:
            return
        _bg_running = True
    threading.Thread(target=_bg_resolve, daemon=True).start()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get(scientific_name: str) -> str | None:
    """
    Return the Portuguese common name if cached, else None.
    Unknown names are automatically queued for background resolution.
    """
    if not scientific_name or scientific_name == "Fish":
        return None

    key = scientific_name.lower()

    with _lock:
        if key in _cache:
            return _cache[key]
        _pending.add(scientific_name)

    _ensure_bg_running()
    return None


def queue_batch(scientific_names: list[str]) -> None:
    """
    Queue multiple names at once (e.g. after fetching a tile).
    Already-cached names are skipped.
    """
    to_add: list[str] = []
    with _lock:
        for name in scientific_names:
            if not name or name == "Fish":
                continue
            if name.lower() not in _cache:
                to_add.append(name)
        _pending.update(to_add)

    if to_add:
        log.info("Queued %d new names for resolution (total pending: %d)", len(to_add), len(_pending))
        _ensure_bg_running()


def stats() -> dict[str, int]:
    """Return cache statistics."""
    with _lock:
        total = len(_cache)
        found = sum(1 for v in _cache.values() if v is not None)
        pending = len(_pending)
    return {"total": total, "found": found, "missing": total - found, "pending": pending}


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------
_load_cache()
