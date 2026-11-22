import asyncio
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Tuple

import aiohttp
from aiohttp import web

from pack_manager import pack_manager
from renderer import render_sticker_pillow, render_grid_pillow, get_loaded_fonts

# ==========================================
# 监听端口与地址显式定义 (可在代码内直接修改)
# ==========================================
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 3000

# 严格读取同目录下的资源和占位目录，完全不依赖上级目录
BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
FONTS_DIR = BASE_DIR / "fonts"
PACKS_DIR = BASE_DIR / "packs"
CONFIG_FILE = BASE_DIR / "config.json"


def load_server_config() -> Tuple[str, int]:
    """读取配置：环境变量 > config.json 配置文件 > 显式默认定义"""
    host = DEFAULT_HOST
    port = DEFAULT_PORT

    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                host = data.get("host", host)
                port = int(data.get("port", port))
        except Exception as e:
            print(f"[Config] 警告: 读取 config.json 失败 ({e})，使用默认配置。")

    if "HOST" in os.environ:
        host = os.environ["HOST"]
    if "PORT" in os.environ:
        try:
            port = int(os.environ["PORT"])
        except ValueError:
            pass

    return host, port


def cors_json_response(data: dict, status: int = 200) -> web.Response:
    return web.json_response(
        data,
        status=status,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
    )


def cors_bytes_response(data: bytes, content_type: str, status: int = 200) -> web.Response:
    return web.Response(
        body=data,
        status=status,
        content_type=content_type,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=86400",
        },
    )


async def handle_options(request: web.Request) -> web.Response:
    return web.Response(
        status=204,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
    )


# 1. 静态网页与资源
async def handle_index(request: web.Request) -> web.Response:
    index_path = PUBLIC_DIR / "index.html"
    if index_path.exists():
        return web.FileResponse(index_path, headers={"Access-Control-Allow-Origin": "*"})
    fallback_html = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'><title>pjsk贴纸制作</title></head>"
        "<body><h1>pjsk贴纸制作</h1>"
        "<p>服务端运行正常。前端文件可放置于 <code>python_server/public/</code> 目录下。</p>"
        "<ul>"
        "<li><a href='/api/status'>/api/status</a> - 服务状态</li>"
        "<li><a href='/api/packs'>/api/packs</a> - 贴纸列表</li>"
        "<li>/api/generate - 贴纸渲染生成</li>"
        "</ul></body></html>"
    )
    return web.Response(text=fallback_html, content_type="text/html", headers={"Access-Control-Allow-Origin": "*"})


async def handle_app_js(request: web.Request) -> web.Response:
    app_file = PUBLIC_DIR / "app.js"
    if app_file.exists():
        return web.FileResponse(app_file, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache, must-revalidate"})
    return web.Response(text="// app.js placeholder", content_type="application/javascript")


async def handle_style_css(request: web.Request) -> web.Response:
    css_file = PUBLIC_DIR / "style.css"
    if css_file.exists():
        return web.FileResponse(css_file, headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache, must-revalidate"})
    return web.Response(text="/* style.css placeholder */", content_type="text/css")


async def handle_font(request: web.Request) -> web.Response:
    font_name = request.match_info.get("name", "")
    font_file = FONTS_DIR / font_name
    if font_file.exists():
        return web.FileResponse(font_file, headers={"Access-Control-Allow-Origin": "*"})
    return cors_json_response({"status": "error", "message": f"Font not found in python_server/fonts/: {font_name}"}, 404)


async def handle_pack_file(request: web.Request) -> web.Response:
    rel_path = request.match_info.get("tail", "")
    pack_file = PACKS_DIR / rel_path
    if pack_file.exists():
        return web.FileResponse(pack_file, headers={"Access-Control-Allow-Origin": "*"})
    return cors_json_response({"status": "error", "message": f"Pack file not found in python_server/packs/: {rel_path}"}, 404)


# 2. 状态查询 API
async def handle_status(request: web.Request) -> web.Response:
    packs_tree = pack_manager.get_packs_tree()
    total_stickers = sum(
        len(stickers)
        for p in packs_tree.values()
        for stickers in p.get("categories", {}).values()
    )
    return cors_json_response({
        "status": "ok",
        "engine": "Pillow (PIL)",
        "platform": "Python (Standalone)",
        "version": "1.0.0",
        "fonts": get_loaded_fonts(),
        "packs_count": len(packs_tree),
        "stickers_count": total_stickers,
        "time": datetime.now(timezone.utc).isoformat(),
    })


# 3. 贴纸树 API
async def handle_packs(request: web.Request) -> web.Response:
    try:
        tree = pack_manager.get_packs_tree()
        return cors_json_response({"status": "ok", "data": tree})
    except Exception as e:
        return cors_json_response({"status": "error", "message": str(e)}, 500)


# 4. 图片直链生成 API (GET)
async def handle_generate_get(request: web.Request) -> web.Response:
    q = request.query
    pack_slug = q.get("pack") or q.get("pack_slug") or "pjsk"
    sticker_name = q.get("sticker") or q.get("sticker_name") or ""
    text = q.get("text", "")
    custom_url = q.get("base_image_url") or q.get("image") or q.get("url")

    sticker_info = pack_manager.find_sticker(pack_slug, sticker_name)
    base_image = custom_url
    width = 296
    height = 256
    if sticker_info:
        s_data = sticker_info["sticker"]
        width = int(s_data.get("width") or 296)
        height = int(s_data.get("height") or 256)
        if not base_image:
            local_base = PACKS_DIR / pack_slug / s_data.get("base_image", "")
            if local_base.exists() and local_base.is_file():
                base_image = str(local_base)
            else:
                base_image = s_data.get("cdn_url") or s_data.get("base_image")

    font_size = float(q.get("size")) if "size" in q else float(sticker_info["sticker"].get("font_size", 42) if sticker_info else 42)
    text_x = float(q.get("x")) if "x" in q else float(sticker_info["sticker"].get("text_x", 148) if sticker_info else 148)
    text_y = float(q.get("y")) if "y" in q else float(sticker_info["sticker"].get("text_y", 58) if sticker_info else 58)
    text_align = q.get("align") or q.get("text_align") or (sticker_info["sticker"].get("text_align", "center") if sticker_info else "center")
    text_rotate = float(q.get("rotate")) if "rotate" in q else float(sticker_info["sticker"].get("text_rotate_degrees", 0) if sticker_info else 0)
    text_color = q.get("color") or (sticker_info["sticker"].get("text_color", [0, 0, 0, 255]) if sticker_info else [0, 0, 0, 255])
    stroke_color = q.get("stroke") or (sticker_info["sticker"].get("stroke_color", [255, 255, 255, 255]) if sticker_info else [255, 255, 255, 255])
    stroke_factor = float(q.get("stroke_width")) if "stroke_width" in q else float(sticker_info["sticker"].get("stroke_width_factor", 0.22) if sticker_info else 0.22)
    auto_resize = q.get("auto_resize", "true").lower() != "false"
    image_format = q.get("format", "png")

    try:
        img_bytes, mime, w, h = await asyncio.to_thread(
            render_sticker_pillow,
            base_image_path=base_image,
            text=text,
            font_size=font_size,
            text_x=text_x,
            text_y=text_y,
            text_align=text_align,
            text_rotate_degrees=text_rotate,
            text_color=text_color,
            stroke_color=stroke_color,
            stroke_width_factor=stroke_factor,
            auto_resize=auto_resize,
            image_format=image_format,
            width=width,
            height=height,
            pack_slug=pack_slug,
        )
        return cors_bytes_response(img_bytes, mime)
    except Exception as e:
        return cors_json_response({"status": "error", "message": str(e)}, 500)


# 5. JSON 生成 API (POST)
async def handle_generate_post(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        body = {}

    pack_slug = body.get("pack_slug") or "pjsk"
    sticker_name = body.get("sticker_name") or ""
    text = body.get("text")
    custom_url = body.get("base_image_url") or body.get("cdn_url") or body.get("base_image") or body.get("image")

    sticker_info = pack_manager.find_sticker(pack_slug, sticker_name)
    base_image = custom_url
    width = 296
    height = 256
    if sticker_info:
        s_data = sticker_info["sticker"]
        width = int(s_data.get("width") or 296)
        height = int(s_data.get("height") or 256)
        if not base_image:
            local_base = PACKS_DIR / pack_slug / s_data.get("base_image", "")
            if local_base.exists() and local_base.is_file():
                base_image = str(local_base)
            else:
                base_image = s_data.get("cdn_url") or s_data.get("base_image")

    final_text = text if text is not None else (sticker_info["sticker"].get("text") if sticker_info else "")
    font_size = float(body.get("font_size") or (sticker_info["sticker"].get("font_size") if sticker_info else 42))
    text_x = float(body.get("text_x") or (sticker_info["sticker"].get("text_x") if sticker_info else 148))
    text_y = float(body.get("text_y") or (sticker_info["sticker"].get("text_y") if sticker_info else 60))
    text_align = body.get("text_align") or (sticker_info["sticker"].get("text_align") if sticker_info else "center")
    text_rotate = float(body.get("text_rotate_degrees") or (sticker_info["sticker"].get("text_rotate_degrees") if sticker_info else 0))
    text_color = body.get("text_color") or (sticker_info["sticker"].get("text_color") if sticker_info else [0, 0, 0, 255])
    stroke_color = body.get("stroke_color") or (sticker_info["sticker"].get("stroke_color") if sticker_info else [255, 255, 255, 255])
    stroke_factor = float(body.get("stroke_width_factor") or (sticker_info["sticker"].get("stroke_width_factor") if sticker_info else 0.22))
    auto_resize = body.get("auto_resize", True) is not False
    image_format = body.get("image_format", "png")

    try:
        img_bytes, mime, w, h = await asyncio.to_thread(
            render_sticker_pillow,
            base_image_path=base_image,
            text=final_text,
            font_size=font_size,
            text_x=text_x,
            text_y=text_y,
            text_align=text_align,
            text_rotate_degrees=text_rotate,
            text_color=text_color,
            stroke_color=stroke_color,
            stroke_width_factor=stroke_factor,
            auto_resize=auto_resize,
            image_format=image_format,
            width=width,
            height=height,
            pack_slug=pack_slug,
        )

        b64 = base64.b64encode(img_bytes).decode("ascii")
        data_uri = f"data:{mime};base64,{b64}"

        return cors_json_response({
            "status": "ok",
            "data": {
                "data_uri": data_uri,
                "width": w,
                "height": h,
                "format": image_format,
                "size_bytes": len(img_bytes),
            },
        })
    except Exception as e:
        return cors_json_response({"status": "error", "message": str(e)}, 500)


# 6. 图片代理 API
async def handle_proxy_image(request: web.Request) -> web.Response:
    target_url = request.query.get("url")
    if not target_url:
        return cors_json_response({"status": "error", "message": "Missing url parameter"}, 400)

    urls_to_try = [
        target_url,
        target_url.replace("https://cdn.jsdelivr.net/gh/lgc-NB2Dev/meme-stickers-hub@main", "https://raw.githubusercontent.com/lgc-NB2Dev/meme-stickers-hub/main"),
        target_url.replace("https://raw.githubusercontent.com", "https://ghfast.top/https://raw.githubusercontent.com"),
    ]

    async with aiohttp.ClientSession() as session:
        for u in urls_to_try:
            try:
                async with session.get(u, headers={"User-Agent": "Mozilla/5.0"}, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        data = await resp.read()
                        if len(data) > 200:
                            ct = resp.headers.get("Content-Type", "image/png")
                            return cors_bytes_response(data, ct)
            except Exception:
                continue

    return cors_json_response({"status": "error", "message": "Failed to fetch image upstream"}, 502)


# 7. 网格预览 API (GET /api/grid)
async def handle_grid_get(request: web.Request) -> web.Response:
    q = request.query
    pack_slug = q.get("pack") or q.get("pack_slug") or "pjsk"
    category = q.get("category") or None
    image_format = q.get("format", "jpeg")
    try:
        quality = int(q.get("quality", 85))
    except ValueError:
        quality = 85

    pack = pack_manager.get_pack(pack_slug)
    if not pack:
        return cors_json_response({"status": "error", "message": f"未找到贴纸包: {pack_slug}"}, 404)

    disable_category_select = bool(pack.get("disable_category_select") or pack.get("sticker_grid", {}).get("disable_category_select"))
    sticker_grid = pack.get("sticker_grid", {})
    items = []
    grid_params = sticker_grid.get("default_params", {})

    if disable_category_select:
        # 全量贴纸大网格（如 Arcaea）
        i = 1
        for cat_name, stickers in pack.get("categories", {}).items():
            for s in stickers:
                items.append({
                    **s,
                    "baseImage": s.get("cdn_url") or s.get("base_image"),
                    "text": f"{i}. {s['name']}",
                })
                i += 1
        grid_params = sticker_grid.get("default_params") or sticker_grid
    elif category:
        # 指定分类下的贴纸网格 (大小写不敏感匹配)
        matched_cat = None
        for c in pack.get("categories", {}):
            if c.lower() == str(category).lower():
                matched_cat = c
                break
        if not matched_cat:
            matched_cat = category

        stickers = pack.get("categories", {}).get(matched_cat)
        if not stickers:
            return cors_json_response({"status": "error", "message": f"未找到分类: {category}"}, 404)

        items = [
            {
                **s,
                "baseImage": s.get("cdn_url") or s.get("base_image"),
                "text": f"{idx + 1}. {s['name']}",
            }
            for idx, s in enumerate(stickers)
        ]
        grid_params = (
            sticker_grid.get("resolved_stickers_params", {}).get(matched_cat)
            or sticker_grid.get("default_params")
            or {}
        )
    else:
        # 分类选择网格（每个分类展示第 1 张代表图，并标序号和分类名）
        categories = sorted(list(pack.get("categories", {}).keys()))
        if not categories:
            return cors_json_response({"status": "error", "message": f"贴纸包 {pack_slug} 中暂无分类"}, 404)

        items = []
        for idx, cat in enumerate(categories):
            stickers = pack["categories"][cat]
            if stickers:
                first = stickers[0]
                items.append({
                    **first,
                    "baseImage": first.get("cdn_url") or first.get("base_image"),
                    "text": f"{idx + 1}. {cat}",
                })
        grid_params = sticker_grid.get("resolved_category_params") or sticker_grid.get("default_params") or {}

    try:
        img_bytes, mime, w, h = await asyncio.to_thread(
            render_grid_pillow,
            items=items,
            cols=grid_params.get("cols"),
            rows=grid_params.get("rows"),
            padding=grid_params.get("padding") or [16, 16, 16, 16],
            gap=grid_params.get("gap") or [16, 16],
            background=grid_params.get("background") or "#282c34",
            sticker_size_fixed=grid_params.get("sticker_size_fixed"),
            pack_slug=pack_slug,
            image_format=image_format,
            quality=quality,
        )
        return cors_bytes_response(img_bytes, mime)
    except Exception as e:
        return cors_json_response({"status": "error", "message": str(e)}, 500)


# 8. 网格预览 API (POST /api/grid)
async def handle_grid_post(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        body = {}

    pack_slug = body.get("pack_slug") or body.get("pack") or "pjsk"
    category = body.get("category") or None
    image_format = body.get("image_format") or body.get("format") or "jpeg"
    try:
        quality = int(body.get("quality", 85))
    except (ValueError, TypeError):
        quality = 85

    pack = pack_manager.get_pack(pack_slug)
    if not pack:
        return cors_json_response({"status": "error", "message": f"未找到贴纸包: {pack_slug}"}, 404)

    disable_category_select = bool(pack.get("disable_category_select") or pack.get("sticker_grid", {}).get("disable_category_select"))
    sticker_grid = pack.get("sticker_grid", {})
    items = []
    grid_params = sticker_grid.get("default_params", {})

    if disable_category_select:
        # 全量贴纸大网格（如 Arcaea）
        i = 1
        for cat_name, stickers in pack.get("categories", {}).items():
            for s in stickers:
                items.append({
                    **s,
                    "baseImage": s.get("cdn_url") or s.get("base_image"),
                    "text": f"{i}. {s['name']}",
                })
                i += 1
        grid_params = sticker_grid.get("default_params") or sticker_grid
    elif category:
        # 指定分类下的贴纸网格 (大小写不敏感匹配)
        matched_cat = None
        for c in pack.get("categories", {}):
            if c.lower() == str(category).lower():
                matched_cat = c
                break
        if not matched_cat:
            matched_cat = category

        stickers = pack.get("categories", {}).get(matched_cat)
        if not stickers:
            return cors_json_response({"status": "error", "message": f"未找到分类: {category}"}, 404)

        items = [
            {
                **s,
                "baseImage": s.get("cdn_url") or s.get("base_image"),
                "text": f"{idx + 1}. {s['name']}",
            }
            for idx, s in enumerate(stickers)
        ]
        grid_params = (
            sticker_grid.get("resolved_stickers_params", {}).get(matched_cat)
            or sticker_grid.get("default_params")
            or {}
        )
    else:
        # 分类选择网格（每个分类展示第 1 张代表图，并标序号和分类名）
        categories = sorted(list(pack.get("categories", {}).keys()))
        if not categories:
            return cors_json_response({"status": "error", "message": f"贴纸包 {pack_slug} 中暂无分类"}, 404)

        items = []
        for idx, cat in enumerate(categories):
            stickers = pack["categories"][cat]
            if stickers:
                first = stickers[0]
                items.append({
                    **first,
                    "baseImage": first.get("cdn_url") or first.get("base_image"),
                    "text": f"{idx + 1}. {cat}",
                })
        grid_params = sticker_grid.get("resolved_category_params") or sticker_grid.get("default_params") or {}

    try:
        img_bytes, mime, w, h = await asyncio.to_thread(
            render_grid_pillow,
            items=items,
            cols=grid_params.get("cols"),
            rows=grid_params.get("rows"),
            padding=grid_params.get("padding") or [16, 16, 16, 16],
            gap=grid_params.get("gap") or [16, 16],
            background=grid_params.get("background") or "#282c34",
            sticker_size_fixed=grid_params.get("sticker_size_fixed"),
            pack_slug=pack_slug,
            image_format=image_format,
            quality=quality,
        )
        b64 = base64.b64encode(img_bytes).decode("ascii")
        data_uri = f"data:{mime};base64,{b64}"

        return cors_json_response({
            "status": "ok",
            "data": {
                "data_uri": data_uri,
                "width": w,
                "height": h,
                "format": image_format,
                "size_bytes": len(img_bytes),
            },
        })
    except Exception as e:
        return cors_json_response({"status": "error", "message": str(e)}, 500)


def make_app() -> web.Application:
    app = web.Application()
    app.router.add_route("OPTIONS", "/{tail:.*}", handle_options)

    # 静态前端 (完全从同级 public/ 读取)
    app.router.add_get("/", handle_index)
    app.router.add_get("/index.html", handle_index)
    app.router.add_get("/playground", handle_index)
    app.router.add_get("/app.js", handle_app_js)
    app.router.add_get("/style.css", handle_style_css)
    app.router.add_get("/fonts/{name}", handle_font)
    app.router.add_get("/packs/{tail:.*}", handle_pack_file)

    # API 接口
    app.router.add_get("/api/status", handle_status)
    app.router.add_get("/api/packs", handle_packs)
    app.router.add_get("/api/generate", handle_generate_get)
    app.router.add_post("/api/generate", handle_generate_post)
    app.router.add_get("/api/grid", handle_grid_get)
    app.router.add_post("/api/grid", handle_grid_post)
    app.router.add_get("/api/proxy-image", handle_proxy_image)

    return app


if __name__ == "__main__":
    host, port = load_server_config()
    print("\n======================================================")
    print("🚀 Meme Stickers Python Server (Standalone) Starting!")
    print(f"📍 Web Playground: http://localhost:{port}")
    print(f"⚡ API Generate:   http://localhost:{port}/api/generate")
    print(f"🖼️ API Grid:       http://localhost:{port}/api/grid")
    print(f"📊 API Packs:      http://localhost:{port}/api/packs")
    print(f"📁 Local Packs:    {PACKS_DIR}")
    print(f"📁 Local Fonts:    {FONTS_DIR}")
    print(f"📁 Local Public:   {PUBLIC_DIR}")
    print(f"🔧 Binding to:     http://{host}:{port}")
    print("======================================================\n")

    app = make_app()
    web.run_app(app, host=host, port=port)
