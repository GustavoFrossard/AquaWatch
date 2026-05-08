"""Cloudinary image upload helper – uses the ``aquawatch/observations`` folder
so images stay isolated from other projects on the same account."""

import base64
import cloudinary
import cloudinary.uploader

from app.config import settings

_configured = False


def _ensure_config():
    global _configured
    if _configured:
        return
    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,
    )
    _configured = True


def upload_base64_image(base64_data: str, public_id: str | None = None) -> str:
    """Upload a base64 image string and return the secure URL.

    Accepts both raw base64 and data-URI (``data:image/...;base64,...``).
    """
    _ensure_config()

    # Strip data-URI prefix if present
    if "," in base64_data and base64_data.startswith("data:"):
        base64_data = base64_data.split(",", 1)[1]

    upload_opts: dict = {
        "folder": "aquawatch/observations",
        "resource_type": "image",
        "overwrite": True,
        "transformation": [
            {"width": 800, "height": 800, "crop": "limit", "quality": "auto:good", "fetch_format": "auto"}
        ],
    }
    if public_id:
        upload_opts["public_id"] = public_id

    result = cloudinary.uploader.upload(
        f"data:image/jpeg;base64,{base64_data}",
        **upload_opts,
    )
    return result["secure_url"]


def delete_image(public_id: str) -> bool:
    """Delete an image from Cloudinary by its public_id."""
    _ensure_config()
    result = cloudinary.uploader.destroy(public_id)
    return result.get("result") == "ok"
