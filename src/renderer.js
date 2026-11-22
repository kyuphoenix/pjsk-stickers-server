import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FONTS_DIR = path.resolve(__dirname, '../fonts');

const loadedFontsList = [];

// Initialize custom fonts
function initFonts() {
  const fontDefinitions = [
    { file: 'YurukaFangTang.ttf', alias: 'YurukaFangTang' },
    { file: 'NotoColorEmoji.ttf', alias: 'Noto Color Emoji' },
  ];

  for (const { file, alias } of fontDefinitions) {
    const fullPath = path.join(FONTS_DIR, file);
    if (fs.existsSync(fullPath)) {
      try {
        const ok = GlobalFonts.registerFromPath(fullPath, alias);
        if (ok) {
          loadedFontsList.push(alias);
          console.log(`[Fonts] Loaded custom font: ${alias} (${file})`);
        }
      } catch (e) {
        console.warn(`[Fonts] Failed to load font ${file}:`, e.message);
      }
    }
  }
}

initFonts();

export function getLoadedFonts() {
  return [...loadedFontsList];
}

function normalizeColor(c) {
  if (Array.isArray(c)) {
    const [r, g, b, a = 255] = c;
    const alpha = typeof a === 'number' && a <= 1 ? a : a / 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
  }
  if (typeof c === 'string') {
    const s = c.trim();
    if (/^[0-9a-fA-F]{3,8}$/.test(s)) {
      return `#${s}`;
    }
    return s;
  }
  return '#000000';
}

function hexToRgbaArray(c) {
  if (Array.isArray(c)) return c;
  if (typeof c === 'string') {
    let hex = c.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
    if (hex.length >= 6) {
      const num = parseInt(hex.slice(0, 6), 16);
      const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) : 255;
      return [(num >> 16) & 255, (num >> 8) & 255, num & 255, a];
    }
  }
  return [255, 255, 255, 255];
}

// Fill enclosed inner loops/counters (e.g. inside 'o', 'g', 'e', 'a') to prevent background leakage
function fillInnerCounters(ctx, w, h, strokeRgba) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let qHead = 0, qTail = 0;

  // Enqueue transparent pixels from outer borders
  for (let x = 0; x < w; x++) {
    if (data[x * 4 + 3] === 0) {
      visited[x] = 1;
      queue[qTail++] = x;
    }
    const b = (h - 1) * w + x;
    if (data[b * 4 + 3] === 0 && !visited[b]) {
      visited[b] = 1;
      queue[qTail++] = b;
    }
  }
  for (let y = 0; y < h; y++) {
    const l = y * w;
    if (data[l * 4 + 3] === 0 && !visited[l]) {
      visited[l] = 1;
      queue[qTail++] = l;
    }
    const r = y * w + (w - 1);
    if (data[r * 4 + 3] === 0 && !visited[r]) {
      visited[r] = 1;
      queue[qTail++] = r;
    }
  }

  // BFS flood fill exterior
  while (qHead < qTail) {
    const curr = queue[qHead++];
    const cx = curr % w;
    const cy = (curr / w) | 0;

    if (cx > 0) {
      const idx = curr - 1;
      if (!visited[idx] && data[idx * 4 + 3] === 0) {
        visited[idx] = 1;
        queue[qTail++] = idx;
      }
    }
    if (cx < w - 1) {
      const idx = curr + 1;
      if (!visited[idx] && data[idx * 4 + 3] === 0) {
        visited[idx] = 1;
        queue[qTail++] = idx;
      }
    }
    if (cy > 0) {
      const idx = curr - w;
      if (!visited[idx] && data[idx * 4 + 3] === 0) {
        visited[idx] = 1;
        queue[qTail++] = idx;
      }
    }
    if (cy < h - 1) {
      const idx = curr + w;
      if (!visited[idx] && data[idx * 4 + 3] === 0) {
        visited[idx] = 1;
        queue[qTail++] = idx;
      }
    }
  }

  // For unvisited pixels, blend stroke color underneath to fill any inner holes cleanly
  const [sr, sg, sb, sa = 255] = strokeRgba;
  for (let i = 0; i < w * h; i++) {
    if (!visited[i]) {
      const a = data[i * 4 + 3];
      if (a === 0) {
        data[i * 4] = sr;
        data[i * 4 + 1] = sg;
        data[i * 4 + 2] = sb;
        data[i * 4 + 3] = sa;
      } else if (a < 255) {
        const topAlpha = a / 255;
        const botAlpha = (sa / 255) * (1 - topAlpha);
        const outAlpha = topAlpha + botAlpha;
        if (outAlpha > 0) {
          data[i * 4] = Math.round((data[i * 4] * topAlpha + sr * botAlpha) / outAlpha);
          data[i * 4 + 1] = Math.round((data[i * 4 + 1] * topAlpha + sg * botAlpha) / outAlpha);
          data[i * 4 + 2] = Math.round((data[i * 4 + 2] * topAlpha + sb * botAlpha) / outAlpha);
          data[i * 4 + 3] = Math.round(outAlpha * 255);
        }
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

function getResizeContain(srcW, srcH, dstW, dstH) {
  const ratio = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * ratio;
  const h = srcH * ratio;
  const x = (dstW - w) / 2;
  const y = (dstH - h) / 2;
  return { ratio, w, h, x, y };
}

function rotatePoint(px, py, ox, oy, rad) {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - ox;
  const dy = py - oy;
  return {
    x: ox + dx * cos - dy * sin,
    y: oy + dx * sin + dy * cos,
  };
}

function calcRotatedAABB(box, origin, deg) {
  const rad = (deg * Math.PI) / 180;
  const [bx, by, bw, bh] = box;
  const corners = [
    rotatePoint(bx, by, origin.x, origin.y, rad),
    rotatePoint(bx + bw, by, origin.x, origin.y, rad),
    rotatePoint(bx + bw, by + bh, origin.x, origin.y, rad),
    rotatePoint(bx, by + bh, origin.x, origin.y, rad),
  ];
  const xs = corners.map(p => p.x);
  const ys = corners.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

const imageCache = new Map();

async function resolveImageSource(src) {
  if (!src) return null;
  if (Buffer.isBuffer(src)) return src;
  if (typeof src !== 'string') return src;
  if (!src.startsWith('http://') && !src.startsWith('https://')) {
    if (fs.existsSync(src)) {
      try {
        return fs.readFileSync(src);
      } catch (_) {}
    }
    return src;
  }

  if (imageCache.has(src)) {
    return imageCache.get(src);
  }

  const urlsToTry = [
    src.replace('https://raw.githubusercontent.com/lgc-NB2Dev/meme-stickers-hub/main', 'https://cdn.jsdelivr.net/gh/lgc-NB2Dev/meme-stickers-hub@main'),
    src,
    src.replace('https://cdn.jsdelivr.net/gh/lgc-NB2Dev/meme-stickers-hub@main', 'https://raw.githubusercontent.com/lgc-NB2Dev/meme-stickers-hub/main'),
    src.replace('https://raw.githubusercontent.com', 'https://ghfast.top/https://raw.githubusercontent.com'),
  ];

  for (const u of urlsToTry) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 500) {
          if (imageCache.size > 300) imageCache.clear();
          imageCache.set(src, buf);
          return buf;
        }
      }
    } catch (_) {}
  }
  return src;
}

export async function renderSticker(options = {}) {
  const {
    baseImage,
    width = 296,
    height = 256,
    text = '',
    textX = width / 2,
    textY = height / 2,
    textAlign = 'center',
    textRotateDegrees = 0,
    textColor = [0, 0, 0, 255],
    strokeColor = [255, 255, 255, 255],
    strokeWidthFactor = 0.2,
    fontSize = 42,
    fontFamilies = ['YurukaFangTang', 'system-ui', 'sans-serif'],
    fontStyle = 'normal',
    autoResize = true,
    imageFormat = 'png',
    quality = 90,
  } = options;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 1. Draw base image
  if (baseImage) {
    try {
      const resolved = await resolveImageSource(baseImage);
      const img = typeof resolved === 'string' || Buffer.isBuffer(resolved)
        ? await loadImage(resolved)
        : resolved;
      const fit = getResizeContain(img.width, img.height, width, height);
      ctx.drawImage(img, fit.x, fit.y, fit.w, fit.h);
    } catch (err) {
      console.warn('Failed to load baseImage, rendering placeholder background:', err.message);
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(0, 0, width, height);
    }
  }

  if (!text) {
    const mime = imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
    return {
      canvas,
      buffer: canvas.toBuffer(mime),
      mime,
      width,
      height,
    };
  }

  // 2. Measure & layout text
  let curFontSize = Number(fontSize) || 42;
  const famStr = fontFamilies.map(f => (f.includes(' ') ? `"${f}"` : f)).join(', ');

  const getMetrics = (sz) => {
    ctx.font = `${fontStyle === 'bold' ? 'bold ' : ''}${Math.round(sz)}px ${famStr}`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = 'middle';
    const m = ctx.measureText(text);
    const tw = m.width;
    const th = (m.actualBoundingBoxAscent || sz * 0.8) + (m.actualBoundingBoxDescent || sz * 0.2);
    const strokeW = sz * strokeWidthFactor;
    const boxW = tw + strokeW * 2;
    const boxH = th + strokeW * 2;
    let boxX = curX - tw / 2 - strokeW;
    if (textAlign === 'left') boxX = curX - strokeW;
    else if (textAlign === 'right') boxX = curX - tw - strokeW;
    const boxY = curY - th / 2 - strokeW;
    return { tw, th, strokeW, box: [boxX, boxY, boxW, boxH] };
  };

  let curX = Number(textX);
  let curY = Number(textY);
  let metrics = getMetrics(curFontSize);

  // 3. Auto resize if needed
  if (autoResize) {
    let aabb = calcRotatedAABB(metrics.box, { x: curX, y: curY }, textRotateDegrees);
    if (aabb.width > width || aabb.height > height) {
      const ratio = Math.min(width / aabb.width, height / aabb.height);
      curFontSize = Math.max(12, Math.floor(curFontSize * ratio * 0.95));
      metrics = getMetrics(curFontSize);
      aabb = calcRotatedAABB(metrics.box, { x: curX, y: curY }, textRotateDegrees);
    }

    // Clamping within canvas
    if (aabb.minX < 0) curX += -aabb.minX + 4;
    else if (aabb.maxX > width) curX -= (aabb.maxX - width + 4);
    if (aabb.minY < 0) curY += -aabb.minY + 4;
    else if (aabb.maxY > height) curY -= (aabb.maxY - height + 4);
  }

  // 4. Render text with inner counter fill (prevents background showing through loops in o, g, e, a, etc.)
  const strokeW = metrics.strokeW;
  const pad = Math.ceil(strokeW * 2 + 30);
  const offW = Math.ceil(metrics.tw + pad * 2);
  const offH = Math.ceil(metrics.th + pad * 2);

  const offCvs = createCanvas(offW, offH);
  const offCtx = offCvs.getContext('2d');
  offCtx.font = `${fontStyle === 'bold' ? 'bold ' : ''}${Math.round(curFontSize)}px ${famStr}`;
  offCtx.textAlign = 'center';
  offCtx.textBaseline = 'middle';

  const cx = offW / 2;
  const cy = offH / 2;

  // Stroke pass
  if (strokeW > 0) {
    offCtx.strokeStyle = normalizeColor(strokeColor);
    offCtx.lineWidth = strokeW * 2;
    offCtx.lineJoin = 'round';
    offCtx.lineCap = 'round';
    offCtx.strokeText(text, cx, cy);
  }

  // Fill pass
  offCtx.fillStyle = normalizeColor(textColor);
  offCtx.fillText(text, cx, cy);

  // Fill inner enclosed loops if stroke is applied
  if (strokeW > 0) {
    const strokeRgba = hexToRgbaArray(strokeColor);
    fillInnerCounters(offCtx, offW, offH, strokeRgba);
  }

  // Draw rotated onto main canvas
  ctx.save();
  ctx.translate(curX, curY);
  ctx.rotate((textRotateDegrees * Math.PI) / 180);

  let drawOffsetX = -cx;
  if (textAlign === 'left') drawOffsetX = -pad;
  else if (textAlign === 'right') drawOffsetX = -offW + pad;

  ctx.drawImage(offCvs, drawOffsetX, -cy);
  ctx.restore();

  const mime = imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
  return {
    canvas,
    buffer: canvas.toBuffer(mime),
    mime,
    width,
    height,
  };
}

function resolvePadding(pad) {
  if (typeof pad === 'number') return [pad, pad, pad, pad];
  if (Array.isArray(pad)) {
    if (pad.length === 1) return [pad[0], pad[0], pad[0], pad[0]];
    if (pad.length === 2) return [pad[1], pad[0], pad[1], pad[0]];
    if (pad.length === 4) return [pad[0], pad[1], pad[2], pad[3]];
  }
  return [16, 16, 16, 16];
}

function resolveGap(gap) {
  if (typeof gap === 'number') return [gap, gap];
  if (Array.isArray(gap) && gap.length >= 2) return [gap[0], gap[1]];
  return [16, 16];
}

export async function renderGrid(options = {}) {
  const {
    items = [],
    cols: requestedCols = 5,
    rows: requestedRows = null,
    padding: rawPadding = [16, 16, 16, 16],
    gap: rawGap = [16, 16],
    background = '#282c34',
    stickerSizeFixed = null,
    packSlug = 'pjsk',
    imageFormat = 'jpeg',
    quality = 85,
  } = options;

  const stickersLen = items.length;
  if (stickersLen === 0) {
    const c = createCanvas(16, 16);
    const mime = imageFormat === 'png' ? 'image/png' : 'image/jpeg';
    return { buffer: c.toBuffer(mime), mime, width: 16, height: 16 };
  }

  let cols = requestedCols;
  let rows = requestedRows;
  if (rows && !cols) {
    rows = Math.min(rows, stickersLen);
    cols = Math.ceil(stickersLen / rows);
  } else {
    cols = Math.min(cols || 5, stickersLen);
    rows = Math.ceil(stickersLen / cols);
  }

  const [gapX, gapY] = resolveGap(rawGap);
  const [padT, padR, padB, padL] = resolvePadding(rawPadding);

  const maxW = stickerSizeFixed ? stickerSizeFixed[0] : Math.max(...items.map(p => p.width || 296));
  const maxH = stickerSizeFixed ? stickerSizeFixed[1] : Math.max(...items.map(p => p.height || 256));

  const surfaceW = Math.round(cols * maxW + (cols - 1) * gapX + padL + padR);
  const surfaceH = Math.round(rows * maxH + (rows - 1) * gapY + padT + padB);

  const canvas = createCanvas(surfaceW, surfaceH);
  const ctx = canvas.getContext('2d');

  // Draw background
  let bgDrawn = false;
  if (typeof background === 'string' && (background.endsWith('.webp') || background.endsWith('.png') || background.endsWith('.jpg') || background.startsWith('http'))) {
    try {
      let bgSrc = background;
      if (!bgSrc.startsWith('http')) {
        const localBg = path.resolve(__dirname, '../packs', packSlug || '', bgSrc);
        if (fs.existsSync(localBg)) {
          bgSrc = localBg;
        } else {
          bgSrc = `https://cdn.jsdelivr.net/gh/lgc-NB2Dev/meme-stickers-hub@main/${packSlug}/${bgSrc}`;
        }
      }
      const resolved = await resolveImageSource(bgSrc);
      if (resolved) {
        const bgImg = typeof resolved === 'string' || Buffer.isBuffer(resolved) ? await loadImage(resolved) : resolved;
        const ratio = Math.max(surfaceW / bgImg.width, surfaceH / bgImg.height);
        const rw = bgImg.width * ratio;
        const rh = bgImg.height * ratio;
        const ox = (surfaceW - rw) / 2;
        const oy = (surfaceH - rh) / 2;
        ctx.drawImage(bgImg, ox, oy, rw, rh);
        bgDrawn = true;
      }
    } catch (e) {
      console.warn(`[renderGrid] Failed to draw background image '${background}':`, e.message);
    }
  }

  if (!bgDrawn) {
    ctx.fillStyle = normalizeColor(background || '#282c34');
    ctx.fillRect(0, 0, surfaceW, surfaceH);
  }

  // Draw each sticker in the grid
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const col = idx % cols;
    const row = Math.floor(idx / cols);

    const cellX = padL + col * (maxW + gapX);
    const cellY = padT + row * (maxH + gapY);

    try {
      const cell = await renderSticker({
        baseImage: item.baseImage || item.cdn_url || item.base_image,
        text: item.text || '',
        fontSize: item.fontSize || item.font_size || 42,
        textX: item.textX !== undefined ? item.textX : (item.text_x !== undefined ? item.text_x : (item.width || 296) / 2),
        textY: item.textY !== undefined ? item.textY : (item.text_y !== undefined ? item.text_y : 60),
        textAlign: item.textAlign || item.text_align || 'center',
        textRotateDegrees: item.textRotateDegrees !== undefined ? item.textRotateDegrees : (item.text_rotate_degrees || 0),
        textColor: item.textColor || item.text_color || [0, 0, 0, 255],
        strokeColor: item.strokeColor || item.stroke_color || [255, 255, 255, 255],
        strokeWidthFactor: item.strokeWidthFactor !== undefined ? item.strokeWidthFactor : (item.stroke_width_factor || 0.22),
        width: item.width || 296,
        height: item.height || 256,
        autoResize: true,
        imageFormat: 'png',
      });

      const ratio = Math.min(maxW / cell.width, maxH / cell.height);
      const rw = cell.width * ratio;
      const rh = cell.height * ratio;
      const ox = cellX + (maxW - rw) / 2;
      const oy = cellY + (maxH - rh) / 2;

      ctx.drawImage(cell.canvas, ox, oy, rw, rh);
    } catch (err) {
      console.warn(`[renderGrid] Failed to render sticker item ${idx}:`, err.message);
    }
  }

  const mime = imageFormat === 'png' ? 'image/png' : 'image/jpeg';
  const buffer = canvas.toBuffer(mime, quality);
  return {
    buffer,
    mime,
    width: surfaceW,
    height: surfaceH,
  };
}
