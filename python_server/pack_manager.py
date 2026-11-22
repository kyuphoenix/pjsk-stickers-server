import copy
import json
import ssl
import urllib.request
from pathlib import Path
from typing import Dict, Any, Optional

from presets import PRESET_PACKS

HUB_CDN_BASE = "https://cdn.jsdelivr.net/gh/lgc-NB2Dev/meme-stickers-hub@main"
HUB_CDN_MIRROR = "https://ghfast.top/https://raw.githubusercontent.com/lgc-NB2Dev/meme-stickers-hub/main"

class PackManager:
    def __init__(self):
        # 严格读取同目录下的 packs 占位/资源目录
        self.packs_dir = Path(__file__).resolve().parent / "packs"
        self.packs: Dict[str, Any] = copy.deepcopy(PRESET_PACKS)
        self.load_local_packs()

    def load_local_packs(self):
        if not self.packs_dir.exists():
            return
        for slug_dir in self.packs_dir.iterdir():
            if slug_dir.is_dir():
                manifest_file = slug_dir / "manifest.json"
                if manifest_file.exists():
                    try:
                        with open(manifest_file, "r", encoding="utf-8") as f:
                            manifest = json.load(f)
                        self.parse_and_store_manifest(slug_dir.name, manifest)
                    except Exception as e:
                        print(f"[PackManager] Error reading local pack {slug_dir.name}: {e}")

    def parse_and_store_manifest(self, slug: str, manifest: dict):
        default_params = manifest.get("default_sticker_params", {})
        cat_dict = {}

        for item in manifest.get("stickers", []):
            cat = item.get("category", "Default")
            if cat not in cat_dict:
                cat_dict[cat] = []

            p = item.get("params", {})
            base_img = p.get("base_image") or default_params.get("base_image", "")
            cdn_url = base_img if base_img.startswith("http") else f"{HUB_CDN_BASE}/{slug}/{base_img}"

            cat_dict[cat].append({
                "name": item.get("name"),
                "category": cat,
                "text": p.get("text", default_params.get("text", "")),
                "base_image": base_img,
                "cdn_url": cdn_url,
                "text_x": p.get("text_x", default_params.get("text_x", 148)),
                "text_y": p.get("text_y", default_params.get("text_y", 60)),
                "text_rotate_degrees": p.get("text_rotate_degrees", default_params.get("text_rotate_degrees", 0)),
                "text_color": p.get("text_color", default_params.get("text_color", [0, 0, 0, 255])),
                "stroke_color": p.get("stroke_color", default_params.get("stroke_color", [255, 255, 255, 255])),
                "stroke_width_factor": p.get("stroke_width_factor", default_params.get("stroke_width_factor", 0.22)),
                "font_size": p.get("font_size", default_params.get("font_size", 42)),
                "font_style": p.get("font_style", default_params.get("font_style", "normal")),
                "text_align": p.get("text_align", default_params.get("text_align", "center")),
                "width": p.get("width", default_params.get("width", 296)),
                "height": p.get("height", default_params.get("height", 256)),
            })

        self.packs[slug] = {
            "name": manifest.get("name", slug),
            "slug": slug,
            "description": manifest.get("description", ""),
            "default_params": default_params,
            "disable_category_select": bool(manifest.get("sticker_grid", {}).get("disable_category_select")),
            "sticker_grid": manifest.get("sticker_grid", {}),
            "categories": cat_dict,
            "_online_loaded": True,
        }

    def fetch_full_pack_online(self, slug: str) -> Optional[dict]:
        mirrors = [
            f"{HUB_CDN_BASE}/{slug}/manifest.json",
            f"{HUB_CDN_MIRROR}/{slug}/manifest.json",
        ]
        headers = {"User-Agent": "Mozilla/5.0"}
        for u in mirrors:
            try:
                req = urllib.request.Request(u, headers=headers)
                try:
                    with urllib.request.urlopen(req, timeout=10.0) as resp:
                        manifest = json.loads(resp.read().decode("utf-8"))
                        self.parse_and_store_manifest(slug, manifest)
                        return self.packs.get(slug)
                except Exception:
                    ctx = ssl._create_unverified_context()
                    with urllib.request.urlopen(req, timeout=10.0, context=ctx) as resp:
                        manifest = json.loads(resp.read().decode("utf-8"))
                        self.parse_and_store_manifest(slug, manifest)
                        return self.packs.get(slug)
            except Exception:
                continue

        return self.packs.get(slug)

    def get_pack(self, pack_slug: str) -> Optional[Dict[str, Any]]:
        if not pack_slug:
            pack_slug = "pjsk"
        pack = self.packs.get(pack_slug)
        if not pack or not pack.get("_online_loaded"):
            pack = self.fetch_full_pack_online(pack_slug) or pack
        return pack

    def get_packs_tree(self) -> Dict[str, Any]:
        result = {}
        for slug, pack in self.packs.items():
            result[slug] = {
                "name": pack.get("name", slug),
                "slug": slug,
                "description": pack.get("description", ""),
                "disable_category_select": bool(pack.get("disable_category_select") or pack.get("sticker_grid", {}).get("disable_category_select")),
                "sticker_grid": pack.get("sticker_grid", {}),
                "categories": pack.get("categories", {}),
            }
        return result

    def find_sticker(self, pack_slug: str, sticker_name: str) -> Optional[Dict[str, Any]]:
        pack = self.get_pack(pack_slug)
        if not pack:
            return None

        s_name_lower = str(sticker_name).lower()
        # 1. Exact match
        for cat_name, stickers in pack.get("categories", {}).items():
            for s in stickers:
                if str(s["name"]).lower() == s_name_lower:
                    return {"sticker": s, "pack": pack, "category": cat_name}

        # 2. Substring match
        for cat_name, stickers in pack.get("categories", {}).items():
            for s in stickers:
                if s_name_lower in str(s["name"]).lower():
                    return {"sticker": s, "pack": pack, "category": cat_name}

        # 3. Fallback: first sticker in first category
        for cat_name, stickers in pack.get("categories", {}).items():
            if stickers:
                return {"sticker": stickers[0], "pack": pack, "category": cat_name}

        return None

pack_manager = PackManager()
