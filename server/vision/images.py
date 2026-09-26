import io

from PIL import Image, ImageOps, UnidentifiedImageError


def prepare_image(data: bytes) -> bytes:
    """Bake in EXIF orientation and keep the upload under Azure's free-tier size."""
    try:
        image = Image.open(io.BytesIO(data))
        image = ImageOps.exif_transpose(image)
    except (UnidentifiedImageError, OSError) as error:
        raise ValueError("unreadable image") from error
    if image.mode != "RGB":
        image = image.convert("RGB")
    longest = max(image.size)
    if longest > 1800:
        scale = 1800 / longest
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.Resampling.LANCZOS,
        )
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=88, optimize=True)
    return out.getvalue()
