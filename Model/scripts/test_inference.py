"""Quick test: run inference on random validation images."""
import base64
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from inference import identify

val_dir = Path(__file__).resolve().parent.parent / "datasets" / "unified" / "val"
species_dirs = [d for d in val_dir.iterdir() if d.is_dir()]

correct_tta = 0
correct_no_tta = 0
total = 50

random.seed(42)
for i in range(total):
    sp = random.choice(species_dirs)
    imgs = list(sp.glob("*.jpg"))
    img = random.choice(imgs)

    with open(img, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    r_no = identify(b64, top_k=3, use_tta=False)
    r_tta = identify(b64, top_k=3, use_tta=True)

    pred_no = r_no["_top_predictions"][0]["species"]
    pred_tta = r_tta["_top_predictions"][0]["species"]
    conf_no = r_no["_model_confidence"]
    conf_tta = r_tta["_model_confidence"]

    ok_no = "OK" if pred_no == sp.name else "MISS"
    ok_tta = "OK" if pred_tta == sp.name else "MISS"

    if pred_no == sp.name:
        correct_no_tta += 1
    if pred_tta == sp.name:
        correct_tta += 1

    print(f"[{i+1:2d}] {sp.name}")
    print(f"     No TTA: {pred_no} ({conf_no:.1%}) {ok_no}")
    print(f"     TTA:    {pred_tta} ({conf_tta:.1%}) {ok_tta}")

print(f"\nAccuracy without TTA: {correct_no_tta}/{total} ({correct_no_tta/total:.0%})")
print(f"Accuracy with TTA:    {correct_tta}/{total} ({correct_tta/total:.0%})")
