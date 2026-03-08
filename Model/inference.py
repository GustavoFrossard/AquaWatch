"""
AquaWatch — Fish species inference module.

Loads the trained EfficientNet-B4 model and provides a simple
`identify(image_bytes) -> dict` API for the FastAPI backend.

Also enriches the prediction with species information from a
supplementary knowledge base (JSON) so the response matches
the same schema the Gemini endpoint used to return.
"""

import base64
import io
import json
import logging
from pathlib import Path

import torch
import torch.nn.functional as F
from PIL import Image
from torchvision import transforms
import timm

log = logging.getLogger("aquawatch.inference")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
MODEL_DIR = Path(__file__).resolve().parent
CHECKPOINTS_DIR = MODEL_DIR / "checkpoints"
BEST_MODEL_PATH = CHECKPOINTS_DIR / "best_model.pth"
LABEL_MAP_PATH = CHECKPOINTS_DIR / "label_map.json"
SPECIES_INFO_PATH = MODEL_DIR / "species_info.json"

IMG_SIZE = 380

# ---------------------------------------------------------------------------
# Singleton model holder
# ---------------------------------------------------------------------------
_model = None
_idx_to_class: dict[int, str] = {}
_species_info: dict[str, dict] = {}
_device = None
_num_classes = 0

_inference_transforms = transforms.Compose([
    transforms.Resize(int(IMG_SIZE * 1.1)),
    transforms.CenterCrop(IMG_SIZE),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])


def load_model():
    """Load model + label map once (lazy singleton)."""
    global _model, _idx_to_class, _species_info, _device, _num_classes

    if _model is not None:
        return  # already loaded

    _device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # Label map
    if not LABEL_MAP_PATH.exists():
        raise FileNotFoundError(f"Label map not found: {LABEL_MAP_PATH}")
    with open(LABEL_MAP_PATH, "r", encoding="utf-8") as f:
        lmap = json.load(f)
    _idx_to_class = {int(k): v for k, v in lmap["idx_to_class"].items()}
    _num_classes = lmap["num_classes"]

    # Model
    if not BEST_MODEL_PATH.exists():
        raise FileNotFoundError(f"Model checkpoint not found: {BEST_MODEL_PATH}")
    _model = timm.create_model("efficientnet_b4", pretrained=False, num_classes=_num_classes)
    ckpt = torch.load(BEST_MODEL_PATH, map_location=_device, weights_only=True)
    _model.load_state_dict(ckpt["model"])
    _model.to(_device)
    _model.eval()
    log.info("Model loaded: %d classes, device=%s", _num_classes, _device)

    # Species info (optional enrichment)
    if SPECIES_INFO_PATH.exists():
        with open(SPECIES_INFO_PATH, "r", encoding="utf-8") as f:
            _species_info = json.load(f)
        log.info("Species info loaded: %d entries", len(_species_info))


def _decode_image(image_data: str) -> Image.Image:
    """Decode a base64 data-URI or raw base64 string into a PIL Image."""
    if image_data.startswith("data:"):
        # strip data:image/jpeg;base64,
        image_data = image_data.split(",", 1)[1]
    raw = base64.b64decode(image_data)
    return Image.open(io.BytesIO(raw)).convert("RGB")


@torch.no_grad()
def identify(image_b64: str, top_k: int = 3) -> dict:
    """
    Identify fish species from a base64-encoded image.

    Returns a dict matching the Gemini schema:
      {
        "nomeCientifico": "...",
        "nomeComum": "...",
        "descricao": "...",
        "tamanho": "...",
        "habitat": "...",
        "alimentacao": "...",
        "conservacao": "...",
        "conservacao_detalhe": "...",
        "curiosidade": "...",
        "confianca": "alta | media | baixa",
      }
    or  {"erro": "..."} on failure.
    """
    load_model()

    try:
        img = _decode_image(image_b64)
    except Exception as e:
        return {"erro": f"Não foi possível decodificar a imagem: {e}"}

    tensor = _inference_transforms(img).unsqueeze(0).to(_device)

    with torch.amp.autocast("cuda", enabled=_device.type == "cuda"):
        logits = _model(tensor)

    probs = F.softmax(logits, dim=1)[0]
    top_probs, top_idxs = probs.topk(top_k)

    best_idx = top_idxs[0].item()
    best_prob = top_probs[0].item()
    species_key = _idx_to_class.get(best_idx, "desconhecido")

    # Confidence mapping
    if best_prob >= 0.75:
        confianca = "alta"
    elif best_prob >= 0.40:
        confianca = "media"
    else:
        confianca = "baixa"

    # Format scientific name
    scientific_name = species_key.replace("_", " ").title()

    # Try to find enriched info
    info = _species_info.get(species_key, {})

    result = {
        "nomeCientifico": info.get("nomeCientifico", scientific_name),
        "nomeComum": info.get("nomeComum", ""),
        "familia": info.get("familia", ""),
        "descricao": info.get("descricao", f"Espécie identificada pelo modelo AquaWatch com {best_prob*100:.1f}% de confiança."),
        "tamanho": info.get("tamanho", ""),
        "habitat": info.get("habitat", ""),
        "alimentacao": info.get("alimentacao", ""),
        "conservacao": info.get("conservacao", "Dados insuficientes"),
        "conservacao_detalhe": info.get("conservacao_detalhe", ""),
        "curiosidade": info.get("curiosidade", ""),
        "confianca": confianca,
        "_model_confidence": round(best_prob, 4),
        "_top_predictions": [
            {"species": _idx_to_class.get(top_idxs[i].item(), "?"), "prob": round(top_probs[i].item(), 4)}
            for i in range(top_k)
        ],
    }

    return result


def is_model_available() -> bool:
    """Check if a trained model exists and can be loaded."""
    return BEST_MODEL_PATH.exists() and LABEL_MAP_PATH.exists()
