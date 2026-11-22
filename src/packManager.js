import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PRESET_PACKS } from './presets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HUB_CDN_BASE = 'https://cdn.jsdelivr.net/gh/lgc-NB2Dev/meme-stickers-hub@main';
const HUB_CDN_MIRROR = 'https://ghfast.top/https://raw.githubusercontent.com/lgc-NB2Dev/meme-stickers-hub/main';

class PackManager {
  constructor() {
    this.memoryPacks = JSON.parse(JSON.stringify(PRESET_PACKS));
    this.onlineCache = new Map();
    this.loadLocalPacks();
  }

  // Load any full packs present in the local packs/ directory
  loadLocalPacks() {
    const packsDir = path.resolve(__dirname, '../packs');
    if (!fs.existsSync(packsDir)) return;

    try {
      const entries = fs.readdirSync(packsDir);
      for (const slug of entries) {
        const manifestPath = path.join(packsDir, slug, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const raw = fs.readFileSync(manifestPath, 'utf-8');
            const manifest = JSON.parse(raw);
            this.parseAndStoreManifest(slug, manifest);
            console.log(`[PackManager] Loaded full pack: ${slug} (${manifest.stickers?.length || 0} stickers)`);
          } catch (e) {
            console.warn(`[PackManager] Error reading local pack ${slug}:`, e.message);
          }
        }
      }
    } catch (err) {
      console.warn('[PackManager] Failed to scan local packs directory:', err.message);
    }
  }

  // Parse a manifest into unified pack structure
  parseAndStoreManifest(slug, manifest) {
    const defaultParams = manifest.default_sticker_params || {};
    const catDict = {};

    for (const item of manifest.stickers || []) {
      const cat = item.category || 'Default';
      if (!catDict[cat]) catDict[cat] = [];

      const p = item.params || {};
      const baseImg = p.base_image || defaultParams.base_image || '';
      const cdnUrl = baseImg.startsWith('http') ? baseImg : `${HUB_CDN_BASE}/${slug}/${baseImg}`;

      catDict[cat].push({
        name: item.name,
        category: cat,
        text: p.text !== undefined ? p.text : (defaultParams.text || ''),
        base_image: baseImg,
        cdn_url: cdnUrl,
        text_x: p.text_x !== undefined ? p.text_x : (defaultParams.text_x || 148),
        text_y: p.text_y !== undefined ? p.text_y : (defaultParams.text_y || 60),
        text_rotate_degrees: p.text_rotate_degrees !== undefined ? p.text_rotate_degrees : (defaultParams.text_rotate_degrees || 0),
        text_color: p.text_color || defaultParams.text_color || [0, 0, 0, 255],
        stroke_color: p.stroke_color || defaultParams.stroke_color || [255, 255, 255, 255],
        stroke_width_factor: p.stroke_width_factor || defaultParams.stroke_width_factor || 0.22,
        font_size: p.font_size || defaultParams.font_size || 42,
        font_style: p.font_style || defaultParams.font_style || 'normal',
        width: p.width || defaultParams.width || 296,
        height: p.height || defaultParams.height || 256,
      });
    }

    const fullPack = {
      name: manifest.name || slug,
      slug,
      description: manifest.description || '',
      default_params: defaultParams,
      disable_category_select: !!(manifest.sticker_grid?.disable_category_select),
      sticker_grid: manifest.sticker_grid || {},
      categories: catDict,
    };

    this.onlineCache.set(slug, fullPack);
    this.memoryPacks[slug] = fullPack;
    return fullPack;
  }

  // Get full sticker tree for UI and /api/packs
  async getPacksTree() {
    const result = {};
    for (const [slug, pack] of Object.entries(this.memoryPacks)) {
      result[slug] = {
        name: pack.name || slug,
        slug: slug,
        description: pack.description || '',
        disable_category_select: !!(pack.disable_category_select || pack.sticker_grid?.disable_category_select),
        sticker_grid: pack.sticker_grid || {},
        categories: pack.categories || {},
      };
    }
    return result;
  }

  // Fetch full pack details from remote CDN on-demand
  async fetchFullPackOnline(slug) {
    if (this.onlineCache.has(slug)) {
      return this.onlineCache.get(slug);
    }

    const mirrors = [
      `${HUB_CDN_BASE}/${slug}/manifest.json`,
      `${HUB_CDN_MIRROR}/${slug}/manifest.json`,
    ];

    for (const url of mirrors) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) continue;
        const manifest = await res.json();
        return this.parseAndStoreManifest(slug, manifest);
      } catch (err) {}
    }

    console.warn(`[PackManager] Failed to fetch full pack '${slug}' online. Using fallback preset.`);
    return this.memoryPacks[slug] || null;
  }

  // Find a specific sticker by pack slug and sticker name
  async findSticker(packSlug, stickerName) {
    if (!packSlug) {
      packSlug = 'pjsk';
    }

    let pack = this.memoryPacks[packSlug];
    if (!pack || !this.onlineCache.has(packSlug)) {
      pack = (await this.fetchFullPackOnline(packSlug)) || pack;
    }

    if (!pack) return null;

    // Search across all categories in pack
    for (const [catName, stickers] of Object.entries(pack.categories || {})) {
      const found = stickers.find(s => 
        s.name.toLowerCase() === String(stickerName).toLowerCase() ||
        s.name.toLowerCase().includes(String(stickerName).toLowerCase())
      );
      if (found) {
        return {
          sticker: found,
          pack: pack,
          category: catName,
        };
      }
    }

    // Fallback: return the first sticker of the first category
    const firstCat = Object.values(pack.categories || {})[0];
    if (firstCat && firstCat.length > 0) {
      return {
        sticker: firstCat[0],
        pack: pack,
        category: Object.keys(pack.categories)[0],
      };
    }

    return null;
  }
}

export const packManager = new PackManager();
