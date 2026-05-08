"""
AquaWatch — Train fish species classifier (v2).

Two-phase training with differential learning rates:
  Phase 1: Freeze backbone, train only classifier head (warmup)
  Phase 2: Unfreeze all, backbone gets lower LR

Features: Mixup, CutMix, early stopping, cosine warmup scheduler,
stronger augmentation, gradient clipping.

Run:  python scripts/train.py [--epochs 60] [--batch 24] [--resume]
"""

import argparse
import json
import random
import sys
import time
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
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
    transforms.RandomResizedCrop(IMG_SIZE, scale=(0.6, 1.0)),
    transforms.RandomHorizontalFlip(),
    transforms.RandomVerticalFlip(p=0.2),
    transforms.ColorJitter(brightness=0.4, contrast=0.4, saturation=0.4, hue=0.15),
    transforms.RandomRotation(20),
    transforms.RandomGrayscale(p=0.1),
    transforms.RandomAffine(degrees=0, translate=(0.1, 0.1)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    transforms.RandomErasing(p=0.3, scale=(0.02, 0.2)),
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
def build_model(num_classes: int, pretrained: bool = True, drop_rate: float = 0.4) -> nn.Module:
    """EfficientNet-B4 with custom classifier head and higher dropout."""
    model = timm.create_model(
        "efficientnet_b4",
        pretrained=pretrained,
        num_classes=num_classes,
        drop_rate=drop_rate,
        drop_path_rate=0.2,
    )
    return model


def freeze_backbone(model: nn.Module):
    """Freeze all layers except the classifier head."""
    for name, param in model.named_parameters():
        if "classifier" not in name:
            param.requires_grad = False


def unfreeze_all(model: nn.Module):
    """Unfreeze all layers."""
    for param in model.parameters():
        param.requires_grad = True


def get_param_groups(model: nn.Module, head_lr: float, backbone_lr: float):
    """Separate parameters into backbone (low LR) and head (high LR) groups."""
    head_params = []
    backbone_params = []
    for name, param in model.named_parameters():
        if not param.requires_grad:
            continue
        if "classifier" in name:
            head_params.append(param)
        else:
            backbone_params.append(param)
    return [
        {"params": backbone_params, "lr": backbone_lr},
        {"params": head_params, "lr": head_lr},
    ]


class SafeImageFolder(ImageFolder):
    """ImageFolder that skips corrupt images instead of crashing."""
    def __getitem__(self, index):
        while True:
            try:
                return super().__getitem__(index)
            except Exception:
                index = (index + 1) % len(self.samples)


# ---------------------------------------------------------------------------
# Mixup / CutMix
# ---------------------------------------------------------------------------
def mixup_data(x, y, alpha=0.2):
    """Mixup: blend two images and their labels."""
    lam = np.random.beta(alpha, alpha) if alpha > 0 else 1.0
    batch_size = x.size(0)
    index = torch.randperm(batch_size, device=x.device)
    mixed_x = lam * x + (1 - lam) * x[index]
    return mixed_x, y, y[index], lam


def cutmix_data(x, y, alpha=1.0):
    """CutMix: paste a patch from one image onto another."""
    lam = np.random.beta(alpha, alpha) if alpha > 0 else 1.0
    batch_size = x.size(0)
    index = torch.randperm(batch_size, device=x.device)

    _, _, h, w = x.shape
    cut_ratio = np.sqrt(1.0 - lam)
    cut_h = int(h * cut_ratio)
    cut_w = int(w * cut_ratio)
    cy = random.randint(0, h - cut_h) if cut_h < h else 0
    cx = random.randint(0, w - cut_w) if cut_w < w else 0

    x_clone = x.clone()
    x_clone[:, :, cy:cy+cut_h, cx:cx+cut_w] = x[index, :, cy:cy+cut_h, cx:cx+cut_w]
    lam = 1 - (cut_h * cut_w) / (h * w)  # adjust lambda to actual area
    return x_clone, y, y[index], lam


def mixup_criterion(criterion, pred, y_a, y_b, lam):
    """Compute mixed loss for mixup/cutmix."""
    return lam * criterion(pred, y_a) + (1 - lam) * criterion(pred, y_b)


# ---------------------------------------------------------------------------
# Training loop
# ---------------------------------------------------------------------------
def train_one_epoch(model, loader, criterion, optimizer, scaler, device, use_mix=True):
    model.train()
    running_loss = 0.0
    correct = 0
    total = 0

    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)

        # Apply mixup or cutmix with 50% probability each
        if use_mix and random.random() < 0.5:
            if random.random() < 0.5:
                images, targets_a, targets_b, lam = mixup_data(images, labels)
            else:
                images, targets_a, targets_b, lam = cutmix_data(images, labels)
            mixed = True
        else:
            mixed = False

        optimizer.zero_grad(set_to_none=True)
        with autocast("cuda", enabled=device.type == "cuda"):
            outputs = model(images)
            if mixed:
                loss = mixup_criterion(criterion, outputs, targets_a, targets_b, lam)
            else:
                loss = criterion(outputs, labels)

        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
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
        with autocast("cuda", enabled=device.type == "cuda"):
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
    parser = argparse.ArgumentParser(description="Train AquaWatch fish classifier v2")
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--warmup-epochs", type=int, default=5,
                        help="Phase 1: train only classifier head")
    parser.add_argument("--batch", type=int, default=24)
    parser.add_argument("--head-lr", type=float, default=1e-3,
                        help="Learning rate for classifier head")
    parser.add_argument("--backbone-lr", type=float, default=1e-5,
                        help="Learning rate for pretrained backbone (phase 2)")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--patience", type=int, default=10,
                        help="Early stopping patience (epochs without val improvement)")
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

    # Weighted sampling for class imbalance — sqrt smoothing
    targets = np.array(train_ds.targets)
    class_counts = np.bincount(targets, minlength=num_classes).astype(float)
    class_counts[class_counts == 0] = 1.0
    # Use sqrt of inverse frequency (gentler than 1/count)
    class_weights = 1.0 / np.sqrt(class_counts)
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
    print(f"Model: EfficientNet-B4 — {total_params:.1f}M params — drop=0.4 — drop_path=0.2")

    # -- Training components --
    criterion = nn.CrossEntropyLoss(label_smoothing=0.1)
    scaler = GradScaler("cuda", enabled=device.type == "cuda")

    CHECKPOINTS_DIR.mkdir(parents=True, exist_ok=True)

    # -- Save label map --
    class_to_idx = train_ds.class_to_idx
    idx_to_class = {v: k for k, v in class_to_idx.items()}
    model_label_map = CHECKPOINTS_DIR / "label_map.json"
    with open(model_label_map, "w", encoding="utf-8") as f:
        json.dump({
            "class_to_idx": class_to_idx,
            "idx_to_class": {str(k): v for k, v in idx_to_class.items()},
            "num_classes": num_classes,
        }, f, ensure_ascii=False, indent=2)

    start_epoch = 0
    best_val_acc = 0.0
    log = []
    patience_counter = 0

    # ======================================================================
    # Phase 1: Freeze backbone — train only head
    # ======================================================================
    if not args.resume:
        print(f"\n{'='*80}")
        print(f"PHASE 1: Head warmup ({args.warmup_epochs} epochs, backbone frozen)")
        print(f"{'='*80}")

        freeze_backbone(model)
        head_optimizer = torch.optim.AdamW(
            filter(lambda p: p.requires_grad, model.parameters()),
            lr=args.head_lr, weight_decay=1e-4,
        )

        for epoch in range(args.warmup_epochs):
            t0 = time.time()
            train_loss, train_acc = train_one_epoch(
                model, train_loader, criterion, head_optimizer, scaler, device, use_mix=False)
            val_loss, val_acc = validate(model, val_loader, criterion, device)
            elapsed = time.time() - t0
            lr = head_optimizer.param_groups[0]["lr"]

            print(f"  WU {epoch:2d} | loss {train_loss:.4f} | acc {train_acc:.4f} | "
                  f"val_loss {val_loss:.4f} | val_acc {val_acc:.4f} | {elapsed:.0f}s")

            log.append({
                "epoch": f"warmup_{epoch}", "train_loss": train_loss,
                "train_acc": train_acc, "val_loss": val_loss,
                "val_acc": val_acc, "lr": lr, "phase": "warmup",
            })

            if val_acc > best_val_acc:
                best_val_acc = val_acc

        unfreeze_all(model)
        print(f"  Head warmup done. Val acc: {best_val_acc:.4f}")

    # ======================================================================
    # Phase 2: Full fine-tuning with differential LR
    # ======================================================================
    print(f"\n{'='*80}")
    print(f"PHASE 2: Full fine-tuning ({args.epochs} epochs, differential LR)")
    print(f"  Head LR: {args.head_lr} | Backbone LR: {args.backbone_lr}")
    print(f"  Early stopping patience: {args.patience}")
    print(f"{'='*80}")

    param_groups = get_param_groups(model, args.head_lr, args.backbone_lr)
    optimizer = torch.optim.AdamW(param_groups, weight_decay=1e-4)

    # Cosine schedule with linear warmup (first 3 epochs)
    warmup_steps = 3
    def lr_lambda(epoch):
        if epoch < warmup_steps:
            return (epoch + 1) / warmup_steps
        progress = (epoch - warmup_steps) / max(1, args.epochs - warmup_steps)
        return max(0.01, 0.5 * (1 + np.cos(np.pi * progress)))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda)

    # -- Resume --
    if args.resume and LAST_MODEL_PATH.exists():
        ckpt = torch.load(LAST_MODEL_PATH, map_location=device, weights_only=False)
        model.load_state_dict(ckpt["model"])
        optimizer.load_state_dict(ckpt["optimizer"])
        scheduler.load_state_dict(ckpt["scheduler"])
        start_epoch = ckpt["epoch"] + 1
        best_val_acc = ckpt.get("best_val_acc", 0.0)
        patience_counter = ckpt.get("patience_counter", 0)
        print(f"Resumed from epoch {start_epoch}, best val acc: {best_val_acc:.4f}")

    print(f"\n{'Epoch':>5} | {'Train Loss':>10} | {'Train Acc':>9} | {'Val Loss':>9} | "
          f"{'Val Acc':>8} | {'BkLR':>10} | {'HdLR':>10} | {'Time':>6}")
    print("-" * 90)

    for epoch in range(start_epoch, args.epochs):
        t0 = time.time()

        train_loss, train_acc = train_one_epoch(
            model, train_loader, criterion, optimizer, scaler, device, use_mix=True)
        val_loss, val_acc = validate(model, val_loader, criterion, device)
        scheduler.step()

        elapsed = time.time() - t0
        bk_lr = optimizer.param_groups[0]["lr"]
        hd_lr = optimizer.param_groups[1]["lr"]

        print(f"{epoch:5d} | {train_loss:10.4f} | {train_acc:8.4f} | {val_loss:9.4f} | "
              f"{val_acc:7.4f} | {bk_lr:10.2e} | {hd_lr:10.2e} | {elapsed:5.1f}s")

        log.append({
            "epoch": epoch, "train_loss": train_loss, "train_acc": train_acc,
            "val_loss": val_loss, "val_acc": val_acc,
            "backbone_lr": bk_lr, "head_lr": hd_lr, "phase": "finetune",
        })

        # Save last
        torch.save({
            "model": model.state_dict(),
            "optimizer": optimizer.state_dict(),
            "scheduler": scheduler.state_dict(),
            "epoch": epoch,
            "best_val_acc": best_val_acc,
            "num_classes": num_classes,
            "patience_counter": patience_counter,
        }, LAST_MODEL_PATH)

        # Save best
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            patience_counter = 0
            torch.save({
                "model": model.state_dict(),
                "epoch": epoch,
                "val_acc": val_acc,
                "num_classes": num_classes,
            }, BEST_MODEL_PATH)
            print(f"  ★ New best val accuracy: {val_acc:.4f}")
        else:
            patience_counter += 1
            if patience_counter >= args.patience:
                print(f"\n  Early stopping: no improvement for {args.patience} epochs.")
                break

        # Save log
        with open(TRAIN_LOG_PATH, "w") as f:
            json.dump(log, f, indent=2)

    print(f"\nTraining complete. Best val accuracy: {best_val_acc:.4f}")
    print(f"Best model saved to: {BEST_MODEL_PATH}")


if __name__ == "__main__":
    main()
