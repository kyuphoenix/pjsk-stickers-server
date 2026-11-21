import base64
import hashlib
import io
import math
import os
from pathlib import Path
from typing import Union, List, Tuple, Optional, Dict
from collections import deque

try:
    import httpx
except ImportError:
    httpx = None

import urllib.request
import urllib.error
import ssl

from PIL import Image, ImageDraw, ImageFont

# 严格读取同目录下的 fonts 占位/资源目录
BASE_DIR = Path(__file__).resolve().parent
FONTS_DIR = BASE_DIR / "fonts"
CACHE_DIR = BASE_DIR / ".cache" / "images"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

_IMAGE_MEMORY_CACHE: Dict[str, Image.Image] = {}
loaded_fonts: List[str] = []

def init_fonts():
    global loaded_fonts
    loaded_fonts = []
    if FONTS_DIR.exists():
        for f in ["YurukaFangTang.ttf", "NotoColorEmoji.ttf"]:
            p = FONTS_DIR / f
            if p.exists():
                loaded_fonts.append(p.name)

init_fonts()

def get_loaded_fonts() -> List[str]:
    return list(loaded_fonts)

def get_font_path(font_name: str = "YurukaFangTang.ttf") -> Optional[str]:
    p = FONTS_DIR / font_name
    if p.exists():
        return str(p)
    return None

def parse_color(color: Union[str, List[int], Tuple[int, ...]]) -> Tuple[int, int, int, int]:
    if isinstance(color, (list, tuple)):
        r = int(color[0])
        g = int(color[1])
        b = int(color[2])
        a = 255
        if len(color) >= 4:
            val = color[3]
            a = int(val * 255) if isinstance(val, float) and val <= 1.0 else int(val)
        return (r, g, b, a)

    if isinstance(color, str):
        c = color.strip().lstrip("#")
        if len(c) == 3:
            c = "".join([x * 2 for x in c])
        if len(c) == 6:
            r = int(c[0:2], 16)
            g = int(c[2:4], 16)
            b = int(c[4:6], 16)
            return (r, g, b, 255)
        if len(c) == 8:
            r = int(c[0:2], 16)
            g = int(c[2:4], 16)
            b = int(c[4:6], 16)
            a = int(c[6:8], 16)
            return (r, g, b, a)

    return (0, 0, 0, 255)

def fill_inner_counters(img: Image.Image, stroke_rgba: Tuple[int, int, int, int]) -> Image.Image:
    """BFS flood-fill exterior transparent pixels, and fill trapped interior holes with stroke color."""
    w, h = img.size
    alpha = img.split()[-1]
    alpha_bytes = bytearray(alpha.tobytes())

    visited = bytearray(w * h)
    queue = deque()

    # Enqueue perimeter transparent pixels
    for x in range(w):
        if alpha_bytes[x] == 0:
            visited[x] = 1
            queue.append(x)
        b = (h - 1) * w + x
        if alpha_bytes[b] == 0 and not visited[b]:
            visited[b] = 1
            queue.append(b)

    for y in range(h):
        l = y * w
        if alpha_bytes[l] == 0 and not visited[l]:
            visited[l] = 1
            queue.append(l)
        r = y * w + (w - 1)
        if alpha_bytes[r] == 0 and not visited[r]:
            visited[r] = 1
            queue.append(r)

    # 4-way BFS
    while queue:
        curr = queue.popleft()
        cx = curr % w
        cy = curr // w

        if cx > 0:
            idx = curr - 1
            if not visited[idx] and alpha_bytes[idx] == 0:
                visited[idx] = 1
                queue.append(idx)
        if cx < w - 1:
            idx = curr + 1
            if not visited[idx] and alpha_bytes[idx] == 0:
                visited[idx] = 1
                queue.append(idx)
        if cy > 0:
            idx = curr - w
            if not visited[idx] and alpha_bytes[idx] == 0:
                visited[idx] = 1
                queue.append(idx)
        if cy < h - 1:
            idx = curr + w
            if not visited[idx] and alpha_bytes[idx] == 0:
                visited[idx] = 1
                queue.append(idx)

    # Unvisited pixels that have alpha < 255 are inner holes -> fill with stroke_rgba
    fill_img = Image.new("RGBA", (w, h), stroke_rgba)
    mask = Image.new("L", (w, h), 0)
    mask_bytes = bytearray(w * h)
    for i in range(w * h):
        if not visited[i]:
            mask_bytes[i] = 255 - alpha_bytes[i]
    mask.frombytes(bytes(mask_bytes))

    # Composite fill_img underneath img
    base = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    base.paste(fill_img, (0, 0), mask)
    base.alpha_composite(img)
    return base

def _get_font(font_size: int) -> ImageFont.ImageFont:
    fp = get_font_path("YurukaFangTang.ttf")
    if fp:
        try:
            return ImageFont.truetype(fp, font_size)
        except Exception:
            pass

    # Fallback to common system fonts
    for name in ["msyh.ttc", "simhei.ttf", "Arial.ttf", "DejaVuSans.ttf"]:
        try:
            return ImageFont.truetype(name, font_size)
        except Exception:
            pass

    return ImageFont.load_default()

def get_candidate_urls(url: str) -> List[str]:
    candidates = [url]
    if "cdn.jsdelivr.net" in url:
        raw = url.replace("https://cdn.jsdelivr.net/gh/lgc-NB2Dev/meme-stickers-hub@main", "https://raw.githubusercontent.com/lgc-NB2Dev/meme-stickers-hub/main")
        candidates.append(raw)
        candidates.append(f"https://ghfast.top/{raw}")
        candidates.append(raw.replace("raw.githubusercontent.com", "raw.gitmirror.com"))
        candidates.append(f"https://gh-proxy.com/{raw}")
    elif "raw.githubusercontent.com" in url:
        jsdelivr = url.replace("https://raw.githubusercontent.com/lgc-NB2Dev/meme-stickers-hub/main", "https://cdn.jsdelivr.net/gh/lgc-NB2Dev/meme-stickers-hub@main")
        candidates.insert(0, jsdelivr)
        candidates.append(f"https://ghfast.top/{url}")
        candidates.append(url.replace("raw.githubusercontent.com", "raw.gitmirror.com"))
        candidates.append(f"https://gh-proxy.com/{url}")
    return list(dict.fromkeys(candidates))

def fetch_url_bytes(url: str, timeout: float = 12.0) -> Optional[bytes]:
    """内置双通道网络下载器：httpx (若有) ➔ Python 标准库 urllib.request (零外部依赖)"""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    }

    # 1. 优先使用 httpx (如果已安装)
    if httpx is not None:
        try:
            with httpx.Client(timeout=timeout, follow_redirects=True, headers=headers) as client:
                resp = client.get(url)
                if resp.status_code == 200 and len(resp.content) > 500:
                    return resp.content
        except Exception:
            pass

    # 2. 回退到 Python 内置标准库 urllib.request (保证在无第三方包环境下永不崩溃)
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
            if len(data) > 500:
                return data
    except Exception:
        # 兼容极简 Docker / Pterodactyl 容器可能缺失根证书的情况
        try:
            ctx = ssl._create_unverified_context()
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                data = resp.read()
                if len(data) > 500:
                    return data
        except Exception:
            pass

    return None

def load_base_image(
    source: Optional[str],
    pack_slug: str = "pjsk",
    default_width: int = 296,
    default_height: int = 256,
) -> Tuple[Image.Image, int, int]:
    """
    Robust image loader supporting:
    1. Base64 Data URI
    2. Local file path (python_server/packs or parent packs)
    3. HTTP / HTTPS URL with multi-mirror fallback and persistent disk caching
    4. Fallback to transparent background canvas if all fail
    """
    if not source:
        return Image.new("RGBA", (default_width, default_height), (0, 0, 0, 0)), default_width, default_height

    src_str = str(source).strip()

    # 1. Base64 Data URI
    if src_str.startswith("data:image/") and "," in src_str:
        try:
            _, b64_part = src_str.split(",", 1)
            raw_bytes = base64.b64decode(b64_part)
            img = Image.open(io.BytesIO(raw_bytes)).convert("RGBA")
            return img, img.width, img.height
        except Exception as e:
            print(f"[Renderer] Error decoding base64 data URI: {e}")

    # 2. Check Memory Cache
    if src_str in _IMAGE_MEMORY_CACHE:
        cached = _IMAGE_MEMORY_CACHE[src_str]
        return cached.copy(), cached.width, cached.height

    # 3. Check Local File Paths
    if os.path.exists(src_str) and os.path.isfile(src_str):
        try:
            img = Image.open(src_str).convert("RGBA")
            _IMAGE_MEMORY_CACHE[src_str] = img
            return img.copy(), img.width, img.height
        except Exception as e:
            print(f"[Renderer] Error loading local file {src_str}: {e}")

    # Search in local packs and parent packs
    search_paths = [
        BASE_DIR / "packs" / src_str,
        BASE_DIR / "packs" / pack_slug / src_str,
        BASE_DIR.parent / "packs" / src_str,
        BASE_DIR.parent / "packs" / pack_slug / src_str,
    ]
    for sp in search_paths:
        if sp.exists() and sp.is_file():
            try:
                img = Image.open(sp).convert("RGBA")
                _IMAGE_MEMORY_CACHE[src_str] = img
                return img.copy(), img.width, img.height
            except Exception:
                pass

    # 4. If not full URL, construct CDN URL
    if not src_str.startswith(("http://", "https://")):
        src_str = f"https://cdn.jsdelivr.net/gh/lgc-NB2Dev/meme-stickers-hub@main/{pack_slug}/{src_str}"

    # Check Disk Cache
    cache_key = hashlib.md5(src_str.encode("utf-8")).hexdigest()
    disk_cache_file = CACHE_DIR / f"{cache_key}.png"
    if disk_cache_file.exists() and disk_cache_file.stat().st_size > 500:
        try:
            img = Image.open(disk_cache_file).convert("RGBA")
            _IMAGE_MEMORY_CACHE[src_str] = img
            return img.copy(), img.width, img.height
        except Exception:
            pass

    # 5. Fetch from Remote CDN with Mirror Fallbacks
    candidate_urls = get_candidate_urls(src_str)
    for u in candidate_urls:
        raw_bytes = fetch_url_bytes(u)
        if raw_bytes:
            try:
                img = Image.open(io.BytesIO(raw_bytes)).convert("RGBA")
                try:
                    disk_cache_file.write_bytes(raw_bytes)
                except Exception:
                    pass
                _IMAGE_MEMORY_CACHE[src_str] = img
                return img.copy(), img.width, img.height
            except Exception:
                continue

    # Fallback placeholder canvas
    print(f"[Renderer] Warning: Could not fetch image for '{src_str}', using fallback canvas.")
    fallback = Image.new("RGBA", (default_width, default_height), (0, 0, 0, 0))
    return fallback, default_width, default_height

def get_resize_contain(src_w: int, src_h: int, dst_w: int, dst_h: int) -> Tuple[int, int, int, int]:
    ratio = min(dst_w / src_w, dst_h / src_h)
    new_w = max(1, int(src_w * ratio))
    new_h = max(1, int(src_h * ratio))
    offset_x = (dst_w - new_w) // 2
    offset_y = (dst_h - new_h) // 2
    return new_w, new_h, offset_x, offset_y

def render_sticker_pillow(
    base_image_path: Optional[str],
    text: str,
    font_size: float = 42.0,
    text_x: float = 148.0,
    text_y: float = 60.0,
    text_align: str = "center",
    text_rotate_degrees: float = 0.0,
    text_color: Union[str, List[int]] = (0, 0, 0, 255),
    stroke_color: Union[str, List[int]] = (255, 255, 255, 255),
    stroke_width_factor: float = 0.22,
    auto_resize: bool = True,
    image_format: str = "png",
    width: int = 296,
    height: int = 256,
    pack_slug: str = "pjsk",
) -> Tuple[bytes, str, int, int]:
    # 1. Base image (contain scaling onto canvas)
    loaded_img, loaded_w, loaded_h = load_base_image(
        base_image_path,
        pack_slug=pack_slug,
        default_width=width,
        default_height=height,
    )

    if loaded_w != width or loaded_h != height:
        rw, rh, ox, oy = get_resize_contain(loaded_w, loaded_h, width, height)
        scaled_base = loaded_img.resize((rw, rh), resample=Image.Resampling.LANCZOS)
        base_canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        base_canvas.alpha_composite(scaled_base, (ox, oy))
    else:
        base_canvas = loaded_img

    if not text:
        buf = io.BytesIO()
        fmt = "JPEG" if image_format.lower() in {"jpg", "jpeg"} else "PNG"
        if fmt == "JPEG":
            bg = Image.new("RGB", (width, height), (255, 255, 255))
            bg.paste(base_canvas, (0, 0), base_canvas)
            bg.save(buf, format="JPEG", quality=95)
            mime = "image/jpeg"
        else:
            base_canvas.save(buf, format="PNG")
            mime = "image/png"
        return buf.getvalue(), mime, width, height

    # 2. Font sizing with auto-resize
    cur_size = int(font_size)
    stroke_width = max(1, int(cur_size * stroke_width_factor))
    font = _get_font(cur_size)

    max_target_w = width * 0.95
    max_target_h = height * 0.95

    if auto_resize and hasattr(font, "getbbox"):
        for _ in range(30):
            bbox = font.getbbox(text, stroke_width=stroke_width)
            tw = (bbox[2] - bbox[0]) + stroke_width * 2
            th = (bbox[3] - bbox[1]) + stroke_width * 2
            if tw > max_target_w or th > max_target_h:
                cur_size -= 2
                if cur_size < 12:
                    cur_size = 12
                    break
                stroke_width = max(1, int(cur_size * stroke_width_factor))
                font = _get_font(cur_size)
            else:
                break

    # 3. Render text on oversized transparent canvas for rotation and stroke
    pad = int(stroke_width * 2 + 10)
    bbox = font.getbbox(text, stroke_width=stroke_width)
    tw = (bbox[2] - bbox[0]) + pad * 2
    th = (bbox[3] - bbox[1]) + pad * 2

    text_canvas = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    t_draw = ImageDraw.Draw(text_canvas)

    fg_rgba = parse_color(text_color)
    bg_rgba = parse_color(stroke_color)

    # Draw outer stroke + fill
    t_draw.text(
        (pad - bbox[0], pad - bbox[1]),
        text,
        font=font,
        fill=fg_rgba,
        stroke_width=stroke_width,
        stroke_fill=bg_rgba,
    )

    # Fill inner counter holes
    text_canvas = fill_inner_counters(text_canvas, bg_rgba)

    # 4. Rotation around alignment anchor
    align_norm = str(text_align).lower()
    if align_norm in {"left", "start"}:
        anchor_x = pad
    elif align_norm in {"right", "end"}:
        anchor_x = tw - pad
    else:
        anchor_x = tw / 2.0
    anchor_y = th / 2.0

    if abs(text_rotate_degrees) > 0.01:
        rotated_canvas = text_canvas.rotate(
            -text_rotate_degrees,
            resample=Image.Resampling.BICUBIC,
            expand=True,
            center=(anchor_x, anchor_y),
        )
        rw, rh = rotated_canvas.size
        draw_x = int(text_x - rw / 2.0)
        draw_y = int(text_y - rh / 2.0)
        text_layer = rotated_canvas
    else:
        draw_x = int(text_x - anchor_x)
        draw_y = int(text_y - anchor_y)
        text_layer = text_canvas

    # 5. Composite text layer on top of base image (the character!)
    final_canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    final_canvas.alpha_composite(base_canvas)
    final_canvas.alpha_composite(text_layer, (draw_x, draw_y))

    # 6. Save image to buffer
    buf = io.BytesIO()
    fmt = "JPEG" if image_format.lower() in {"jpg", "jpeg"} else "PNG"
    if fmt == "JPEG":
        rgb_canvas = Image.new("RGB", (width, height), (255, 255, 255))
        rgb_canvas.paste(final_canvas, (0, 0), final_canvas)
        rgb_canvas.save(buf, format="JPEG", quality=95)
        mime = "image/jpeg"
    else:
        final_canvas.save(buf, format="PNG")
        mime = "image/png"

    return buf.getvalue(), mime, width, height
