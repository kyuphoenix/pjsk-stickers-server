import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderSticker, renderGrid, getLoadedFonts } from './renderer.js';
import { packManager } from './packManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

// Helper to parse JSON body from incoming stream
async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// Send JSON response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

// Send binary buffer
function sendBuffer(res, statusCode, mimeType, buffer) {
  res.writeHead(statusCode, {
    'Content-Type': mimeType,
    'Content-Length': buffer.length,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=86400',
  });
  res.end(buffer);
}

// Serve static file
function serveStaticFile(res, filePath, contentType, cacheControl = 'no-cache, must-revalidate') {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(content);
      return true;
    }
  } catch (e) {}
  return false;
}

// Main request dispatcher (compatible with native HTTP and Vercel Serverless Function)
export async function handleRequest(req, res) {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // 1. Root / Playground Page
  if (pathname === '/' || pathname === '/index.html' || pathname === '/playground') {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if (serveStaticFile(res, indexPath, 'text/html; charset=utf-8')) {
      return;
    }
    // Fallback inline HTML if file not found
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<h1>pjsk贴纸制作</h1><p>Frontend assets missing.</p>');
  }

  // 2. Static Assets in public/
  if (pathname === '/app.js') {
    return serveStaticFile(res, path.join(PUBLIC_DIR, 'app.js'), 'application/javascript; charset=utf-8');
  }
  if (pathname === '/style.css') {
    return serveStaticFile(res, path.join(PUBLIC_DIR, 'style.css'), 'text/css; charset=utf-8');
  }

  // 2.1 Static Fonts (/fonts/:fontName)
  if (pathname.startsWith('/fonts/')) {
    const fontName = path.basename(pathname);
    const fontFile = path.join(__dirname, '../fonts', fontName);
    if (serveStaticFile(res, fontFile, 'font/ttf', 'public, max-age=86400')) {
      return;
    }
  }

  // 2.2 Static Packs (/packs/:slug/:file)
  if (pathname.startsWith('/packs/')) {
    const relPath = pathname.replace(/^\/packs\//, '');
    const packFile = path.join(__dirname, '../packs', relPath);
    const mime = relPath.endsWith('.json') ? 'application/json' : 'image/png';
    if (serveStaticFile(res, packFile, mime, 'public, max-age=86400')) {
      return;
    }
  }

  // 2.3 Image proxy for frontend to bypass CORS & CDN rate limits
  if (pathname === '/api/proxy-image' || pathname.endsWith('/proxy-image')) {
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
      return sendJson(res, 400, { status: 'error', message: 'Missing url parameter' });
    }
    try {
      const urlsToTry = [
        targetUrl,
        targetUrl.replace('https://cdn.jsdelivr.net/gh/lgc-NB2Dev/meme-stickers-hub@main', 'https://raw.githubusercontent.com/lgc-NB2Dev/meme-stickers-hub/main'),
        targetUrl.replace('https://raw.githubusercontent.com', 'https://ghfast.top/https://raw.githubusercontent.com'),
      ];
      for (const u of urlsToTry) {
        try {
          const resp = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer());
            if (buf.length > 200) {
              const contentType = resp.headers.get('content-type') || 'image/png';
              return sendBuffer(res, 200, contentType, buf);
            }
          }
        } catch (_) {}
      }
      return sendJson(res, 502, { status: 'error', message: 'Failed to fetch image upstream' });
    } catch (e) {
      return sendJson(res, 500, { status: 'error', message: e.message });
    }
  }

  // 3. API: Status
  if (pathname === '/api/status' || pathname.endsWith('/status')) {
    const packsTree = await packManager.getPacksTree();
    let totalStickers = 0;
    for (const p of Object.values(packsTree)) {
      for (const list of Object.values(p.categories || {})) {
        totalStickers += list.length;
      }
    }
    return sendJson(res, 200, {
      status: 'ok',
      engine: '@napi-rs/canvas',
      platform: 'Node.js (Serverless Ready - Route A)',
      version: '1.0.0',
      fonts: getLoadedFonts(),
      packs_count: Object.keys(packsTree).length,
      stickers_count: totalStickers,
      time: new Date().toISOString(),
    });
  }

  // 4. API: Packs tree
  if (pathname === '/api/packs' || pathname.endsWith('/packs')) {
    try {
      const tree = await packManager.getPacksTree();
      return sendJson(res, 200, { status: 'ok', data: tree });
    } catch (e) {
      return sendJson(res, 500, { status: 'error', message: e.message });
    }
  }

  // 5. API: Direct GET image generation (?pack=...&sticker=...&text=...)
  if (pathname === '/api/generate' && req.method === 'GET') {
    try {
      const packSlug = url.searchParams.get('pack') || url.searchParams.get('pack_slug') || 'pjsk';
      const stickerName = url.searchParams.get('sticker') || url.searchParams.get('sticker_name') || '';
      const text = url.searchParams.get('text') || '';
      const customUrl = url.searchParams.get('image') || url.searchParams.get('url');

      let stickerInfo = await packManager.findSticker(packSlug, stickerName);
      let baseImage = customUrl || (stickerInfo ? (stickerInfo.sticker.cdn_url || stickerInfo.sticker.base_image) : null);

      const renderOpts = {
        baseImage,
        text: text !== null ? text : (stickerInfo?.sticker.text || ''),
        fontSize: url.searchParams.has('size') ? Number(url.searchParams.get('size')) : (stickerInfo?.sticker.font_size || 42),
        textX: url.searchParams.has('x') ? Number(url.searchParams.get('x')) : (stickerInfo?.sticker.text_x !== undefined ? stickerInfo.sticker.text_x : 148),
        textY: url.searchParams.has('y') ? Number(url.searchParams.get('y')) : (stickerInfo?.sticker.text_y !== undefined ? stickerInfo.sticker.text_y : 58),
        textAlign: url.searchParams.get('align') || url.searchParams.get('text_align') || stickerInfo?.sticker.text_align || 'center',
        textRotateDegrees: url.searchParams.has('rotate') ? Number(url.searchParams.get('rotate')) : (stickerInfo?.sticker.text_rotate_degrees || 0),
        textColor: url.searchParams.get('color') || stickerInfo?.sticker.text_color || [0, 0, 0, 255],
        strokeColor: url.searchParams.get('stroke') || stickerInfo?.sticker.stroke_color || [255, 255, 255, 255],
        strokeWidthFactor: url.searchParams.has('stroke_width') ? Number(url.searchParams.get('stroke_width')) : (stickerInfo?.sticker.stroke_width_factor !== undefined ? stickerInfo.sticker.stroke_width_factor : 0.22),
        autoResize: url.searchParams.get('auto_resize') !== 'false',
        imageFormat: url.searchParams.get('format') || 'png',
      };

      const result = await renderSticker(renderOpts);
      return sendBuffer(res, 200, result.mime, result.buffer);
    } catch (err) {
      return sendJson(res, 500, { status: 'error', message: err.message });
    }
  }

  // 6. API: POST JSON generation
  if ((pathname === '/api/generate' || pathname.endsWith('/generate')) && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const packSlug = body.pack_slug || 'pjsk';
      const stickerName = body.sticker_name || '';

      let stickerInfo = await packManager.findSticker(packSlug, stickerName);
      let baseImage = body.base_image_url || (stickerInfo ? (stickerInfo.sticker.cdn_url || stickerInfo.sticker.base_image) : null);

      const renderOpts = {
        baseImage,
        text: body.text !== undefined ? body.text : (stickerInfo?.sticker.text || ''),
        fontSize: body.font_size !== undefined ? Number(body.font_size) : (stickerInfo?.sticker.font_size || 42),
        textX: body.text_x !== undefined ? Number(body.text_x) : (stickerInfo?.sticker.text_x || 148),
        textY: body.text_y !== undefined ? Number(body.text_y) : (stickerInfo?.sticker.text_y || 60),
        textAlign: body.text_align || body.textAlign || stickerInfo?.sticker.text_align || 'center',
        textRotateDegrees: body.text_rotate_degrees !== undefined ? Number(body.text_rotate_degrees) : (stickerInfo?.sticker.text_rotate_degrees || 0),
        textColor: body.text_color || stickerInfo?.sticker.text_color || [0, 0, 0, 255],
        strokeColor: body.stroke_color || stickerInfo?.sticker.stroke_color || [255, 255, 255, 255],
        strokeWidthFactor: body.stroke_width_factor !== undefined ? Number(body.stroke_width_factor) : (stickerInfo?.sticker.stroke_width_factor || 0.22),
        autoResize: body.auto_resize !== false,
        imageFormat: body.image_format || 'png',
      };

      const result = await renderSticker(renderOpts);
      const b64 = result.buffer.toString('base64');
      const dataUri = `data:${result.mime};base64,${b64}`;

      return sendJson(res, 200, {
        status: 'ok',
        data: {
          data_uri: dataUri,
          width: result.width,
          height: result.height,
          format: renderOpts.imageFormat,
          size_bytes: result.buffer.length,
        },
      });
    } catch (err) {
      return sendJson(res, 500, { status: 'error', message: err.message });
    }
  }

  // 7. API: Grid preview (GET /api/grid or POST /api/grid)
  if (pathname === '/api/grid' || pathname.endsWith('/grid')) {
    try {
      let packSlug, category, format, quality;
      if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        packSlug = body.pack_slug || body.pack || 'pjsk';
        category = body.category || null;
        format = body.image_format || body.format || 'jpeg';
        quality = body.quality ? Number(body.quality) : 85;
      } else {
        packSlug = url.searchParams.get('pack') || url.searchParams.get('pack_slug') || 'pjsk';
        category = url.searchParams.get('category') || null;
        format = url.searchParams.get('format') || 'jpeg';
        quality = url.searchParams.has('quality') ? Number(url.searchParams.get('quality')) : 85;
      }

      let pack = packManager.memoryPacks[packSlug];
      if (!pack || !packManager.onlineCache.has(packSlug)) {
        pack = (await packManager.fetchFullPackOnline(packSlug)) || pack;
      }
      if (!pack) {
        return sendJson(res, 404, { status: 'error', message: `未找到贴纸包: ${packSlug}` });
      }

      const disableCategorySelect = !!(pack.disable_category_select || pack.sticker_grid?.disable_category_select);
      const stickerGrid = pack.sticker_grid || {};
      let items = [];
      let gridParams = stickerGrid.default_params || {};

      if (disableCategorySelect) {
        // 全量贴纸大网格（如 Arcaea）
        let i = 1;
        for (const [catName, stickers] of Object.entries(pack.categories || {})) {
          for (const s of stickers) {
            items.push({
              ...s,
              baseImage: s.cdn_url || s.base_image,
              text: `${i}. ${s.name}`,
            });
            i++;
          }
        }
        gridParams = stickerGrid.default_params || stickerGrid || {};
      } else if (category) {
        // 指定分类下的贴纸网格 (支持大小写不敏感匹配)
        const matchedCat = Object.keys(pack.categories || {}).find(c => c.toLowerCase() === String(category).toLowerCase()) || category;
        const stickers = pack.categories?.[matchedCat];
        if (!stickers || stickers.length === 0) {
          return sendJson(res, 404, { status: 'error', message: `未找到分类: ${category}` });
        }
        items = stickers.map((s, idx) => ({
          ...s,
          baseImage: s.cdn_url || s.base_image,
          text: `${idx + 1}. ${s.name}`,
        }));
        gridParams = stickerGrid.resolved_stickers_params?.[matchedCat] || stickerGrid.default_params || {};
      } else {
        // 分类选择网格（每个分类展示第 1 张代表图，并标序号和分类名）
        const categories = Object.keys(pack.categories || {}).sort();
        if (categories.length === 0) {
          return sendJson(res, 404, { status: 'error', message: `贴纸包 ${packSlug} 中暂无分类` });
        }
        items = categories.map((cat, idx) => {
          const first = pack.categories[cat][0];
          return {
            ...first,
            baseImage: first.cdn_url || first.base_image,
            text: `${idx + 1}. ${cat}`,
          };
        });
        gridParams = stickerGrid.resolved_category_params || stickerGrid.default_params || {};
      }

      const result = await renderGrid({
        items,
        packSlug,
        cols: gridParams.cols,
        rows: gridParams.rows,
        padding: gridParams.padding,
        gap: gridParams.gap,
        background: gridParams.background,
        stickerSizeFixed: gridParams.sticker_size_fixed,
        imageFormat: format,
        quality,
      });

      if (req.method === 'POST') {
        const b64 = result.buffer.toString('base64');
        return sendJson(res, 200, {
          status: 'ok',
          data: {
            data_uri: `data:${result.mime};base64,${b64}`,
            width: result.width,
            height: result.height,
            format,
            size_bytes: result.buffer.length,
          },
        });
      }

      return sendBuffer(res, 200, result.mime, result.buffer);
    } catch (err) {
      return sendJson(res, 500, { status: 'error', message: err.message });
    }
  }

  // 404
  return sendJson(res, 404, { status: 'error', message: `Route not found: ${pathname}` });
}
