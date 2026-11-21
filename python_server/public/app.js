// Client script for Meme Stickers Playground with Real-time 60FPS Pure Frontend Canvas Rendering
let globalPacks = {};
let currentSelectedSticker = null;
let currentBaseImage = null;
let rafId = null;
let serverDebounceTimer = null;
let reqSeq = 0;
let fontLoaded = false;
const clientImageCache = new Map();

// Reusable offscreen canvas to avoid GC pauses during 60FPS slider dragging
let offscreenCanvas = null;
let offscreenCtx = null;
function getOffscreenCanvas(w, h) {
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
    offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (offscreenCanvas.width !== w || offscreenCanvas.height !== h) {
    offscreenCanvas.width = w;
    offscreenCanvas.height = h;
  } else {
    offscreenCtx.clearRect(0, 0, w, h);
  }
  return { offscreenCanvas, offCtx: offscreenCtx, offscreenCtx };
}

// DOM references
const dom = {
  packSelect: document.getElementById('pack-select'),
  categorySelect: document.getElementById('category-select'),
  stickerSelect: document.getElementById('sticker-select'),
  textInput: document.getElementById('text-input'),
  fontSize: document.getElementById('font-size'),
  fontSizeVal: document.getElementById('font-size-val'),
  rotateDeg: document.getElementById('rotate-deg'),
  rotateDegVal: document.getElementById('rotate-deg-val'),
  strokeWidth: document.getElementById('stroke-width'),
  strokeWidthVal: document.getElementById('stroke-width-val'),
  textAlign: document.getElementById('text-align'),
  textColor: document.getElementById('text-color'),
  textColorHex: document.getElementById('text-color-hex'),
  strokeColor: document.getElementById('stroke-color'),
  strokeColorHex: document.getElementById('stroke-color-hex'),
  textX: document.getElementById('text-x'),
  textY: document.getElementById('text-y'),
  imageFormat: document.getElementById('image-format'),
  autoResize: document.getElementById('auto-resize'),
  clientRenderToggle: document.getElementById('client-render-toggle'),
  livePreviewToggle: document.getElementById('live-preview-toggle'),
  previewCanvas: document.getElementById('preview-canvas'),
  previewImg: document.getElementById('preview-img'),
  previewMeta: document.getElementById('preview-meta'),
  loadingSpinner: document.getElementById('loading-spinner'),
  btnCopy: document.getElementById('btn-copy'),
  btnDownload: document.getElementById('btn-download'),
  btnTestApi: document.getElementById('btn-test-api'),
  btnResetParams: document.getElementById('btn-reset-params'),
  btnCopyUrl: document.getElementById('btn-copy-url'),
  apiGetUrl: document.getElementById('api-get-url'),
  apiMdCode: document.getElementById('api-md-code'),
};

// Switch navigation tabs
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const tabId = btn.dataset.tab;
    const target = document.getElementById(`tab-${tabId}`);
    if (target) target.classList.add('active');
  });
});

// Copy helper
window.copyText = function(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  let text = el.innerText.trim();
  // Strip leading HTTP method like 'GET ' when copying API URL
  if (elementId === 'api-get-url') {
    text = text.replace(/^GET\s+/i, '');
  }
  navigator.clipboard.writeText(text).then(() => {
    alert('已复制到剪贴板！');
  }).catch(() => {
    if (typeof prompt !== 'undefined') {
      prompt('请手动复制：', text);
    } else {
      alert('复制失败，请手动选中文本复制。');
    }
  });
};

// Convert rgba array to hex string
function rgbaToHex(rgba) {
  if (typeof rgba === 'string') return rgba;
  if (!Array.isArray(rgba)) return '#000000';
  const [r, g, b] = rgba;
  return '#' + [r, g, b].map(x => Math.round(x || 0).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Convert hex to [r, g, b, 255]
function hexToRgba(hex) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  const a = c.length >= 8 ? parseInt(c.slice(6, 8), 16) : 255;
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255, a];
}

// Geometry helpers
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

function getResizeContain(srcW, srcH, dstW, dstH) {
  const ratio = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * ratio;
  const h = srcH * ratio;
  const x = (dstW - w) / 2;
  const y = (dstH - h) / 2;
  return { ratio, w, h, x, y };
}

// Fill enclosed inner loops/counters (e.g. inside 'o', 'g', 'e', 'a') to prevent background leakage
function fillInnerCounters(ctx, w, h, strokeRgba) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let qHead = 0, qTail = 0;

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

// Client image loader with memory cache and proxy fallback
async function loadClientImage(url) {
  if (!url) return null;
  if (clientImageCache.has(url)) {
    return clientImageCache.get(url);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      clientImageCache.set(url, img);
      resolve(img);
    };
    img.onerror = () => {
      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
      const proxyImg = new Image();
      proxyImg.crossOrigin = 'anonymous';
      proxyImg.onload = () => {
        clientImageCache.set(url, proxyImg);
        resolve(proxyImg);
      };
      proxyImg.onerror = () => {
        console.warn('Failed to load image via proxy fallback:', url);
        resolve(null);
      };
      proxyImg.src = proxyUrl;
    };
    img.src = url;
  });
}

// Initialize Web Font
async function initWebFont() {
  try {
    const font = new FontFace('YurukaFangTang', 'url(/fonts/YurukaFangTang.ttf)');
    const loaded = await font.load();
    document.fonts.add(loaded);
    fontLoaded = true;
    console.log('[WebFont] YurukaFangTang loaded successfully into browser');
    requestRender();
  } catch (e) {
    console.warn('[WebFont] Failed to load YurukaFangTang:', e);
  }
}

// Load packs tree
async function initPacks() {
  try {
    const res = await fetch('/api/packs');
    const json = await res.json();
    globalPacks = json.data || {};

    dom.packSelect.innerHTML = '';
    for (const [slug, pack] of Object.entries(globalPacks)) {
      const opt = document.createElement('option');
      opt.value = slug;
      opt.textContent = pack.name || slug;
      dom.packSelect.appendChild(opt);
    }

    onPackChanged();
  } catch (err) {
    console.error('Failed to load packs:', err);
  }
}

function onPackChanged() {
  const slug = dom.packSelect.value;
  const pack = globalPacks[slug];
  if (!pack || !pack.categories) return;

  dom.categorySelect.innerHTML = '';
  for (const cat of Object.keys(pack.categories)) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    dom.categorySelect.appendChild(opt);
  }

  onCategoryChanged();
}

function onCategoryChanged() {
  const slug = dom.packSelect.value;
  const cat = dom.categorySelect.value;
  const pack = globalPacks[slug];
  const stickers = pack?.categories[cat] || [];

  dom.stickerSelect.innerHTML = '';
  for (const s of stickers) {
    const opt = document.createElement('option');
    opt.value = s.name;
    opt.textContent = s.name;
    dom.stickerSelect.appendChild(opt);
  }

  onStickerChanged();
}

async function onStickerChanged() {
  const slug = dom.packSelect.value;
  const cat = dom.categorySelect.value;
  const sName = dom.stickerSelect.value;
  const pack = globalPacks[slug];
  const stickers = pack?.categories[cat] || [];
  const sticker = stickers.find(s => s.name === sName);

  if (!sticker) return;
  currentSelectedSticker = sticker;

  // Apply defaults
  dom.textInput.value = 'something';
  dom.fontSize.value = sticker.font_size || 42;
  dom.fontSizeVal.textContent = `${dom.fontSize.value}px`;
  dom.rotateDeg.value = Math.round(sticker.text_rotate_degrees || 0);
  dom.rotateDegVal.textContent = `${dom.rotateDeg.value}°`;
  dom.strokeWidth.value = sticker.stroke_width_factor || 0.22;
  dom.strokeWidthVal.textContent = dom.strokeWidth.value;
  dom.textX.value = sticker.text_x || 148;
  dom.textY.value = sticker.text_y || 58;

  const textHex = rgbaToHex(sticker.text_color);
  dom.textColor.value = textHex;
  dom.textColorHex.value = textHex;

  const strokeHex = rgbaToHex(sticker.stroke_color);
  dom.strokeColor.value = strokeHex;
  dom.strokeColorHex.value = strokeHex;

  updateApiDocs();

  // Render immediately with placeholder or cached image
  requestRender();

  // Load and cache base image asynchronously
  const imgUrl = sticker.cdn_url || sticker.base_image;
  if (imgUrl) {
    loadClientImage(imgUrl).then(img => {
      currentBaseImage = img;
      requestRender();
    });
  } else {
    currentBaseImage = null;
    requestRender();
  }
}

let currentApiGetUrl = '';

function updateApiDocs() {
  const host = window.location.origin;
  const pack = dom.packSelect.value;
  const sticker = dom.stickerSelect.value;
  const text = dom.textInput.value || 'something';
  const stickerObj = currentSelectedSticker;

  const params = new URLSearchParams();
  params.set('pack', pack);
  params.set('sticker', sticker);
  params.set('text', text);

  // 1. Text Color (if modified from sticker preset default)
  const curColorHex = (dom.textColorHex.value || dom.textColor.value || '').trim();
  const defaultColorHex = stickerObj ? rgbaToHex(stickerObj.text_color) : '';
  if (curColorHex && defaultColorHex && curColorHex.toUpperCase() !== defaultColorHex.toUpperCase()) {
    params.set('color', curColorHex);
  }

  // 2. Stroke Color (if modified from sticker preset default)
  const curStrokeHex = (dom.strokeColorHex.value || dom.strokeColor.value || '').trim();
  const defaultStrokeHex = stickerObj ? rgbaToHex(stickerObj.stroke_color) : '#FFFFFF';
  if (curStrokeHex && defaultStrokeHex && curStrokeHex.toUpperCase() !== defaultStrokeHex.toUpperCase()) {
    params.set('stroke', curStrokeHex);
  }

  // 3. Font Size (if modified from sticker preset default)
  const curFontSize = Number(dom.fontSize.value);
  const defaultFontSize = Number(stickerObj?.font_size ?? 42);
  if (curFontSize && curFontSize !== defaultFontSize) {
    params.set('size', curFontSize);
  }

  // 4. Rotation Angle (if modified from sticker preset default)
  const curRotate = Number(dom.rotateDeg.value);
  const defaultRotate = Math.round(Number(stickerObj?.text_rotate_degrees ?? 0));
  if (curRotate !== defaultRotate) {
    params.set('rotate', curRotate);
  }

  // 5. Stroke Width Factor (if modified from sticker preset default)
  const curStrokeWidth = Number(dom.strokeWidth.value);
  const defaultStrokeWidth = Number(stickerObj?.stroke_width_factor ?? 0.22);
  if (curStrokeWidth && Math.abs(curStrokeWidth - defaultStrokeWidth) > 0.005) {
    params.set('stroke_width', curStrokeWidth);
  }

  // 6. Text Alignment (if modified from sticker preset default)
  const curAlign = dom.textAlign.value || 'center';
  const defaultAlign = stickerObj?.text_align || 'center';
  if (curAlign !== defaultAlign) {
    params.set('align', curAlign);
  }

  // 7. Text Coordinates X & Y (if modified from sticker preset default)
  const curX = Number(dom.textX.value);
  const defaultX = Number(stickerObj?.text_x ?? 148);
  if (curX && curX !== defaultX) {
    params.set('x', curX);
  }

  const curY = Number(dom.textY.value);
  const defaultY = Number(stickerObj?.text_y ?? 58);
  if (curY && curY !== defaultY) {
    params.set('y', curY);
  }

  // 8. Auto Resize (if disabled)
  if (!dom.autoResize.checked) {
    params.set('auto_resize', 'false');
  }

  // 9. Format (if not png)
  const curFormat = dom.imageFormat.value || 'png';
  if (curFormat !== 'png') {
    params.set('format', curFormat);
  }

  currentApiGetUrl = `${host}/api/generate?${params.toString()}`;
  dom.apiGetUrl.textContent = `GET ${currentApiGetUrl}`;
  dom.apiMdCode.textContent = `![${sticker}](${currentApiGetUrl})`;
}

// 60FPS / 120FPS Real-Time Animation Frame Dispatcher
function requestRender() {
  if (!dom.livePreviewToggle.checked) return;

  if (dom.clientRenderToggle.checked) {
    // Pure frontend rendering: Render on next GPU animation frame without any delay
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      renderClientCanvasSync();
    });
  } else {
    // Server API rendering (throttled when user chooses server mode)
    clearTimeout(serverDebounceTimer);
    serverDebounceTimer = setTimeout(doServerRender, 150);
  }
}

// 1. Pure Frontend Canvas 2D Synchronous Rendering (Runs in 0ms on GPU)
function renderClientCanvasSync() {
  const t0 = performance.now();
  dom.previewCanvas.style.display = 'block';
  dom.previewImg.style.display = 'none';

  const canvas = dom.previewCanvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const width = currentSelectedSticker?.width || 296;
  const height = currentSelectedSticker?.height || 256;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.clearRect(0, 0, width, height);

  // 1. Draw base image from preloaded memory cache
  if (currentBaseImage) {
    const fit = getResizeContain(currentBaseImage.width, currentBaseImage.height, width, height);
    ctx.drawImage(currentBaseImage, fit.x, fit.y, fit.w, fit.h);
  } else {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, width, height);
  }

  const text = dom.textInput.value;
  if (!text) {
    const t1 = performance.now();
    updatePreviewMeta(width, height, (t1 - t0).toFixed(1), '前端 Canvas 2D (0ms 实时)');
    return;
  }

  // 2. Measure & layout
  let curFontSize = Number(dom.fontSize.value) || 42;
  const strokeWidthFactor = Number(dom.strokeWidth.value) || 0.22;
  const rotateDeg = Number(dom.rotateDeg.value) || 0;
  const textAlign = dom.textAlign.value || 'center';
  const famStr = 'YurukaFangTang, "Noto Color Emoji", sans-serif';

  let curX = Number(dom.textX.value) || 148;
  let curY = Number(dom.textY.value) || 58;

  const getMetrics = (sz) => {
    ctx.font = `${Math.round(sz)}px ${famStr}`;
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

  let metrics = getMetrics(curFontSize);

  // 3. Auto resize if needed
  if (dom.autoResize.checked) {
    let aabb = calcRotatedAABB(metrics.box, { x: curX, y: curY }, rotateDeg);
    if (aabb.width > width || aabb.height > height) {
      const ratio = Math.min(width / aabb.width, height / aabb.height);
      curFontSize = Math.max(12, Math.floor(curFontSize * ratio * 0.95));
      metrics = getMetrics(curFontSize);
      aabb = calcRotatedAABB(metrics.box, { x: curX, y: curY }, rotateDeg);
    }

    if (aabb.minX < 0) curX += -aabb.minX + 4;
    else if (aabb.maxX > width) curX -= (aabb.maxX - width + 4);
    if (aabb.minY < 0) curY += -aabb.minY + 4;
    else if (aabb.maxY > height) curY -= (aabb.maxY - height + 4);
  }

  // 4. Render text onto reusable offscreen canvas with counter fill
  const strokeW = metrics.strokeW;
  const pad = Math.ceil(strokeW * 2 + 30);
  const offW = Math.ceil(metrics.tw + pad * 2);
  const offH = Math.ceil(metrics.th + pad * 2);

  const { offCtx } = getOffscreenCanvas(offW, offH);

  offCtx.font = `${Math.round(curFontSize)}px ${famStr}`;
  offCtx.textAlign = 'center';
  offCtx.textBaseline = 'middle';

  const cx = offW / 2;
  const cy = offH / 2;

  // Stroke pass
  if (strokeW > 0) {
    offCtx.strokeStyle = dom.strokeColor.value || dom.strokeColorHex.value || '#FFFFFF';
    offCtx.lineWidth = strokeW * 2;
    offCtx.lineJoin = 'round';
    offCtx.lineCap = 'round';
    offCtx.strokeText(text, cx, cy);
  }

  // Fill pass
  offCtx.fillStyle = dom.textColor.value || dom.textColorHex.value || '#000000';
  offCtx.fillText(text, cx, cy);

  // Fill inner counter loops (o, g, e, a, etc.) so background never leaks through!
  if (strokeW > 0) {
    try {
      const strokeRgba = hexToRgba(dom.strokeColor.value || dom.strokeColorHex.value || '#FFFFFF');
      fillInnerCounters(offCtx, offW, offH, strokeRgba);
    } catch (e) {
      console.warn('Counter fill non-critical notice:', e);
    }
  }

  // Draw rotated onto main target canvas
  ctx.save();
  ctx.translate(curX, curY);
  ctx.rotate((rotateDeg * Math.PI) / 180);

  let drawOffsetX = -cx;
  if (textAlign === 'left') drawOffsetX = -pad;
  else if (textAlign === 'right') drawOffsetX = -offW + pad;

  ctx.drawImage(offscreenCanvas, drawOffsetX, -cy);
  ctx.restore();

  const t1 = performance.now();
  updatePreviewMeta(width, height, (t1 - t0).toFixed(1), '前端 Canvas 2D (0ms 实时)');
}

// 2. Server API Rendering (for testing Serverless route)
async function doServerRender() {
  const thisSeq = ++reqSeq;
  dom.loadingSpinner.classList.remove('hidden');
  const t0 = performance.now();

  const payload = {
    pack_slug: dom.packSelect.value,
    sticker_name: dom.stickerSelect.value,
    base_image_url: currentSelectedSticker?.cdn_url || currentSelectedSticker?.base_image || null,
    text: dom.textInput.value,
    font_size: Number(dom.fontSize.value),
    text_x: Number(dom.textX.value),
    text_y: Number(dom.textY.value),
    text_rotate_degrees: Number(dom.rotateDeg.value),
    stroke_width_factor: Number(dom.strokeWidth.value),
    text_align: dom.textAlign.value,
    text_color: hexToRgba(dom.textColorHex.value),
    stroke_color: hexToRgba(dom.strokeColorHex.value),
    auto_resize: dom.autoResize.checked,
    image_format: dom.imageFormat.value,
  };

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    if (thisSeq !== reqSeq) return;

    const dataUri = json.data?.data_uri;
    if (dataUri) {
      dom.previewCanvas.style.display = 'none';
      dom.previewImg.style.display = 'block';
      dom.previewImg.src = dataUri;

      const t1 = performance.now();
      updatePreviewMeta(json.data.width, json.data.height, (t1 - t0).toFixed(0), 'Node.js API');
    }
  } catch (err) {
    console.error('Server render error:', err);
  } finally {
    if (thisSeq === reqSeq) {
      dom.loadingSpinner.classList.add('hidden');
    }
  }
}

function updatePreviewMeta(w, h, timeMs, engine) {
  dom.previewMeta.textContent = `尺寸: ${w} × ${h} px · 引擎: ${engine} · 耗时: ${timeMs}ms · 格式: ${dom.imageFormat.value.toUpperCase()}`;
}

// Get Image Blob on Demand (called when copying or downloading)
function getCurrentImageBlob() {
  return new Promise((resolve) => {
    if (dom.previewCanvas.style.display !== 'none') {
      dom.previewCanvas.toBlob(resolve, 'image/png');
    } else if (dom.previewImg.src) {
      fetch(dom.previewImg.src).then(r => r.blob()).then(resolve).catch(() => resolve(null));
    } else {
      resolve(null);
    }
  });
}

// Event bindings
dom.packSelect.addEventListener('change', onPackChanged);
dom.categorySelect.addEventListener('change', onCategoryChanged);
dom.stickerSelect.addEventListener('change', onStickerChanged);

// Instant Continuous Tracking for Sliders and Inputs
dom.fontSize.addEventListener('input', e => {
  dom.fontSizeVal.textContent = `${e.target.value}px`;
  requestRender();
  updateApiDocs();
});
dom.fontSize.addEventListener('change', updateApiDocs);

dom.rotateDeg.addEventListener('input', e => {
  dom.rotateDegVal.textContent = `${e.target.value}°`;
  requestRender();
  updateApiDocs();
});
dom.rotateDeg.addEventListener('change', updateApiDocs);

dom.strokeWidth.addEventListener('input', e => {
  dom.strokeWidthVal.textContent = e.target.value;
  requestRender();
  updateApiDocs();
});
dom.strokeWidth.addEventListener('change', updateApiDocs);

dom.textInput.addEventListener('input', () => {
  updateApiDocs();
  requestRender();
});

dom.textAlign.addEventListener('change', () => {
  updateApiDocs();
  requestRender();
});

dom.textX.addEventListener('input', () => {
  requestRender();
  updateApiDocs();
});
dom.textX.addEventListener('change', updateApiDocs);

dom.textY.addEventListener('input', () => {
  requestRender();
  updateApiDocs();
});
dom.textY.addEventListener('change', updateApiDocs);

dom.autoResize.addEventListener('change', () => {
  updateApiDocs();
  requestRender();
});

dom.imageFormat.addEventListener('change', () => {
  updateApiDocs();
  requestRender();
});

dom.textColor.addEventListener('input', e => {
  dom.textColorHex.value = e.target.value;
  requestRender();
  updateApiDocs();
});
dom.textColor.addEventListener('change', updateApiDocs);

dom.textColorHex.addEventListener('input', e => {
  dom.textColor.value = e.target.value;
  requestRender();
  updateApiDocs();
});
dom.textColorHex.addEventListener('change', updateApiDocs);

dom.strokeColor.addEventListener('input', e => {
  dom.strokeColorHex.value = e.target.value;
  requestRender();
  updateApiDocs();
});
dom.strokeColor.addEventListener('change', updateApiDocs);

dom.strokeColorHex.addEventListener('input', e => {
  dom.strokeColor.value = e.target.value;
  requestRender();
  updateApiDocs();
});
dom.strokeColorHex.addEventListener('change', updateApiDocs);

dom.clientRenderToggle.addEventListener('change', () => {
  requestRender();
});

// Test API Button
dom.btnTestApi.addEventListener('click', () => {
  doServerRender();
});

// Copy Image Button (ClipboardItem API)
dom.btnCopy.addEventListener('click', async () => {
  dom.btnCopy.disabled = true;
  try {
    const blob = await getCurrentImageBlob();
    if (!blob) {
      alert('暂无可用图片');
      return;
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    dom.btnCopy.textContent = '✅ 已复制到剪贴板！';
    setTimeout(() => { dom.btnCopy.textContent = '📋 复制图片到剪贴板'; }, 2000);
  } catch (err) {
    console.warn('Clipboard write error:', err);
    alert('浏览器剪贴板权限受限或非HTTPS环境，请右键图片直接复制。');
  } finally {
    dom.btnCopy.disabled = false;
  }
});

// Download Image Button
dom.btnDownload.addEventListener('click', async () => {
  const isCanvas = dom.previewCanvas.style.display !== 'none';
  if (isCanvas) {
    const url = dom.previewCanvas.toDataURL(`image/${dom.imageFormat.value}`);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sticker_${dom.stickerSelect.value || 'meme'}.${dom.imageFormat.value}`;
    a.click();
  } else if (dom.previewImg.src) {
    const a = document.createElement('a');
    a.href = dom.previewImg.src;
    a.download = `sticker_${dom.stickerSelect.value || 'meme'}.${dom.imageFormat.value}`;
    a.click();
  }
});

// Copy Direct API URL (copies clean URL without 'GET ' method prefix)
dom.btnCopyUrl.addEventListener('click', async () => {
  if (!currentApiGetUrl) {
    updateApiDocs();
  }
  const cleanUrl = currentApiGetUrl || dom.apiGetUrl.innerText.replace(/^GET\s+/i, '').trim();
  try {
    await navigator.clipboard.writeText(cleanUrl);
    dom.btnCopyUrl.textContent = '✅ 已复制直链 URL！';
    setTimeout(() => { dom.btnCopyUrl.textContent = '🔗 复制 API 直链'; }, 2000);
  } catch (err) {
    if (typeof prompt !== 'undefined') {
      prompt('请手动复制直链 URL：', cleanUrl);
    } else {
      console.warn('Clipboard write failed:', err);
    }
  }
});

// Reset parameters button (restores defaults for all parameters EXCEPT text input content)
if (dom.btnResetParams) {
  dom.btnResetParams.addEventListener('click', () => {
    if (!currentSelectedSticker) return;
    const sticker = currentSelectedSticker;

    dom.fontSize.value = sticker.font_size || 42;
    dom.fontSizeVal.textContent = `${dom.fontSize.value}px`;
    dom.rotateDeg.value = Math.round(sticker.text_rotate_degrees || 0);
    dom.rotateDegVal.textContent = `${dom.rotateDeg.value}°`;
    dom.strokeWidth.value = sticker.stroke_width_factor !== undefined ? sticker.stroke_width_factor : 0.22;
    dom.strokeWidthVal.textContent = dom.strokeWidth.value;
    dom.textAlign.value = sticker.text_align || 'center';
    dom.textX.value = sticker.text_x !== undefined ? sticker.text_x : 148;
    dom.textY.value = sticker.text_y !== undefined ? sticker.text_y : 58;

    const textHex = rgbaToHex(sticker.text_color || [0, 0, 0, 255]);
    dom.textColor.value = textHex;
    dom.textColorHex.value = textHex;

    const strokeHex = rgbaToHex(sticker.stroke_color || [255, 255, 255, 255]);
    dom.strokeColor.value = strokeHex;
    dom.strokeColorHex.value = strokeHex;

    dom.imageFormat.value = 'png';
    dom.autoResize.checked = true;

    // Do NOT touch dom.textInput.value!

    updateApiDocs();
    requestRender();

    const originalText = dom.btnResetParams.textContent;
    dom.btnResetParams.textContent = '✅ 已重置参数！';
    setTimeout(() => { dom.btnResetParams.textContent = originalText; }, 1500);
  });
}

// Init on load
initWebFont();
initPacks();
