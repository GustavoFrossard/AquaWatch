"""
AquaWatch — Train fish species classifier.

Uses a pre-trained EfficientNet-B4 (via timm) fine-tuned on the unified
fish dataset.  Supports mixed-precision (AMP) and cosine-annealing LR.

Run:  python scripts/train.py [--epochs 30] [--batch 32] [--resume]
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, WeightedRandomSampler
from torchvision import transforms
from torchvision.datasets import ImageFolder
from torch.amp import GradScaler, autocast
import timm
import numpy as np
from PIL import ImageFile, Image

# Allow loading truncated images instead of crashing
ImageFile.LOAD_TRUNCATED_IMAGES = True
Image.MAX_IMAGE_PIXELS = None

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
UNIFIED_DIR = ROOT / "datasets" / "unified"
TRAIN_DIR = UNIFIED_DIR / "train"
VAL_DIR = UNIFIED_DIR / "val"
LABEL_MAP_PATH = UNIFIED_DIR / "label_map.json"
CHECKPOINTS_DIR = ROOT / "checkpoints"

BEST_MODEL_PATH = CHECKPOINTS_DIR / "best_model.pth"
LAST_MODEL_PATH = CHECKPOINTS_DIR / "last_model.pth"
TRAIN_LOG_PATH = CHECKPOINTS_DIR / "train_log.json"

# ---------------------------------------------------------------------------
# Transforms
# ---------------------------------------------------------------------------
IMG_SIZE = 380  # EfficientNet-B4 native size

train_transforms = transforms.Compose([
    transforms.RandomResizedCrop(IMG_SIZE, scale=(0.7, 1.0)),
    transforms.RandomHorizontalFlip(),
    transforms.RandomVerticalFlip(p=0.2),
    transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3, hue=0.1),
    transforms.RandomRotation(15),
    transforms.RandomGrayscale(p=0.05),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    transforms.RandomErasing(p=0.2),
])

val_transforms = transforms.Compose([
    transforms.Resize(int(IMG_SIZE * 1.1)),
    transforms.CenterCrop(IMG_SIZE),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------
def build_model(num_classes: int, pretrained: bool = True) -> nn.Module:
    """EfficientNet-B4 with custom classifier head."""
    model = timm.create_model("efficientnet_b4", pretrained=pretrained, num_classes=num_classes)
    return model


class SafeImageFolder(ImageFolder):
    """ImageFolder that skips corrupt images instead of crashing."""
    def __getitem__(self, index):
        while True:
            try:
                return super().__getitem__(index)
            except Exception:
                index = (index + 1) % len(self.samples)


# ---------------------------------------------------------------------------
# Training loop
# ---------------------------------------------------------------------------
def train_one_epoch(model, loader, criterion, optimizer, scaler, device):
    model.train()
    running_loss = 0.0
    correct = 0
    total = 0

    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)

        optimizer.zero_grad(set_to_none=True)
        with autocast("cuda"):
            outputs = model(images)
            loss = criterion(outputs, labels)

        scaler.scale(loss).backward()
        scaler.step(optimizer)
        scaler.update()

        running_loss += loss.item() * images.size(0)
        _, predicted = outputs.max(1)
        total += labels.size(0)
        correct += predicted.eq(labels).sum().item()

    return running_loss / total, correct / total


@torch.no_grad()
def validate(model, loader, criterion, device):
    model.eval()
    running_loss = 0.0
    correct = 0
    total = 0

    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)
        with autocast("cuda"):
            outputs = model(images)
            loss = criterion(outputs, labels)

        running_loss += loss.item() * images.size(0)
        _, predicted = outputs.max(1)
        total += labels.size(0)
        correct += predicted.eq(labels).sum().item()

    return running_loss / total, correct / total


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Train AquaWatch fish classifier")
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch", type=int, default=24)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--resume", action="store_true", help="Resume from last checkpoint")
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")
    if device.type == "cuda":
        print(f"GPU: {torch.cuda.get_device_name(0)}")

    # -- Datasets --
    if not TRAIN_DIR.exists():
        print("ERROR: Unified dataset not found. Run `python scripts/download_datasets.py` first.")
        sys.exit(1)

    train_ds = SafeImageFolder(str(TRAIN_DIR), transform=train_transforms)
    val_ds = SafeImageFolder(str(VAL_DIR), transform=val_transforms)
    num_classes = len(train_ds.classes)

    print(f"Train: {len(train_ds)} images — Val: {len(val_ds)} images — Classes: {num_classes}")

    # Weighted sampling for class imbalance
    targets = np.array(train_ds.targets)
    class_counts = np.bincount(targets, minlength=num_classes).astype(float)
    class_counts[class_counts == 0] = 1.0
    class_weights = 1.0 / class_counts
    sample_weights = class_weights[targets]
    sampler = WeightedRandomSampler(sample_weights, num_samples=len(train_ds), replacement=True)

    train_loader = DataLoader(
        train_ds, batch_size=args.batch, sampler=sampler,
        num_workers=args.workers, pin_memory=True, drop_last=True,
    )
    val_loader = DataLoader(
        val_ds, batch_size=args.batch, shuffle=False,
        num_workers=args.workers, pin_memory=True,
    )

    # -- Model --
    model = build_model(num_classes).to(device)
    total_params = sum(p.numel() for p in model.parameters()) / 1e6
    print(f"Model: EfficientNet-B4 — {total_params:.1f}M params")

    # -- Training components --
    criterion = nn.CrossEntropyLoss(label_smoothing=0.1)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs, eta_min=1e-6)
    scaler = GradScaler("cuda")

    start_epoch = 0
    best_val_acc = 0.0
    log = []

    # -- Resume --
    if args.resume and LAST_MODEL_PATH.exists():
        ckpt = torch.load(LAST_MODEL_PATH, map_location=device, weights_only=False)
        model.load_state_dict(ckpt["model"])
        optimizer.load_state_dict(ckpt["optimizer"])
        scheduler.load_state_dict(ckpt["scheduler"])
        start_epoch = ckpt["epoch"] + 1
        best_val_acc = ckpt.get("best_val_acc", 0.0)
        print(f"Resumed from epoch {start_epoch}, best val acc: {best_val_acc:.4f}")

    CHECKPOINTS_DIR.mkdir(parents=True, exist_ok=True)

    # -- Verify label map consistency --
    # Save the ImageFolder class-to-idx mapping so inference uses the same mapping
    class_to_idx = train_ds.class_to_idx
    idx_to_class = {v: k for k, v in class_to_idx.items()}
    model_label_map = CHECKPOINTS_DIR / "label_map.json"
    with open(model_label_map, "w", encoding="utf-8") as f:
        json.dump({
            "class_to_idx": class_to_idx,
            "idx_to_class": {str(k): v for k, v in idx_to_class.items()},
            "num_classes": num_classes,
        }, f, ensure_ascii=False, indent=2)

    # -- Train --
    print(f"\n{'Epoch':>5} | {'Train Loss':>10} | {'Train Acc':>9} | {'Val Loss':>9} | {'Val Acc':>8} | {'LR':>10} | {'Time':>6}")
    print("-" * 80)

    for epoch in range(start_epoch, args.epochs):
        t0 = time.time()

        train_loss, train_acc = train_one_epoch(model, train_loader, criterion, optimizer, scaler, device)
        val_loss, val_acc = validate(model, val_loader, criterion, device)
        scheduler.step()

        elapsed = time.time() - t0
        lr = optimizer.param_groups[0]["lr"]

        print(f"{epoch:5d} | {train_loss:10.4f} | {train_acc:8.4f} | {val_loss:9.4f} | {val_acc:7.4f} | {lr:10.6f} | {elapsed:5.1f}s")

        log.append({
            "epoch": epoch,
            "train_loss": train_loss,
            "train_acc": train_acc,
            "val_loss": val_loss,
            "val_acc": val_acc,
            "lr": lr,
        })

        # Save last
        torch.save({
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "scheduler": scheduler.state_dict(),
            "epoch": epoch,
            "best_val_acc": best_val_acc,
            "num_classes": num_classes,
        }, LAST_MODEL_PATH)

        # Save best
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save({
                "model": model.state_dict(),
                "epoch": epoch,
                "val_acc": val_acc,
                "num_classes": num_classes,
            }, BEST_MODEL_PATH)
            print(f"  ★ New best val accuracy: {val_acc:.4f}")

        # Save log
        with open(TRAIN_LOG_PATH, "w") as f:
            json.dump(log, f, indent=2)

    print(f"\nTraining complete. Best val accuracy: {best_val_acc:.4f}")
    print(f"Best model saved to: {BEST_MODEL_PATH}")


if __name__ == "__main__":
    main()
