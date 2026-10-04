"""
Media handling and thumbnail generation with EXIF orientation correction.
"""

import io
import os

from config import CACHE_DIR

try:
    from PIL import Image, ImageOps
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def generate_thumbnail(media_type, media_data):
    """
    Lightweight in-memory Pillow resize with EXIF orientation correction.
    Encodes output as WebP at 80% quality.
    """
    if not HAS_PIL:
        return media_data, media_type

    if media_type and media_type.startswith("image/"):
        try:
            img = Image.open(io.BytesIO(media_data))
            try:
                img = ImageOps.exif_transpose(img)
            except Exception:
                pass
            img.thumbnail((320, 320), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                img.save(out, format="WEBP", quality=80)
            else:
                img.convert("RGB").save(out, format="WEBP", quality=80)
            return out.getvalue(), "image/webp"
        except Exception:
            return media_data, media_type

    return media_data, media_type


def get_or_create_thumbnail(user_id, msg_id, media_type, media_data):
    """Retrieves cached thumbnail from CACHE_DIR or generates and caches a new one."""
    cache_file = os.path.join(CACHE_DIR, f"{user_id}_{msg_id}.webp")
    if os.path.isfile(cache_file) and os.path.getsize(cache_file) > 0:
        try:
            with open(cache_file, "rb") as f:
                return f.read(), "image/webp"
        except Exception:
            pass

    thumb_data, thumb_type = generate_thumbnail(media_type, media_data)

    if thumb_type == "image/webp":
        try:
            tmp_cache = cache_file + f".tmp.{os.getpid()}"
            with open(tmp_cache, "wb") as f:
                f.write(thumb_data)
            os.replace(tmp_cache, cache_file)
        except Exception as e:
            print(f"Error saving thumbnail cache: {e}")

    return thumb_data, thumb_type
