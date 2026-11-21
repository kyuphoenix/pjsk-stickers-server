import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const MIRRORS = [
  'https://raw.githubusercontent.com/lgc-NB2Dev/meme-stickers-hub/main',
  'https://ghfast.top/https://raw.githubusercontent.com/lgc-NB2Dev/meme-stickers-hub/main',
  'https://cdn.jsdelivr.net/gh/lgc-NB2Dev/meme-stickers-hub@main',
];

async function fetchWithFallback(subPath) {
  for (const base of MIRRORS) {
    const url = `${base}/${subPath}`;
    try {
      console.log(`Downloading: ${url} ...`);
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 50) {
          console.log(`✓ Success: ${subPath} (${(buf.length / 1024).toFixed(1)} KB)`);
          return buf;
        }
      }
    } catch (err) {
      console.warn(`  Failed from ${base}: ${err.message}`);
    }
  }
  throw new Error(`Failed to download ${subPath} from all mirrors`);
}

async function main() {
  console.log('=== Syncing Meme Stickers Assets (Full Packs & Core Font) ===\n');

  // 1. Ensure directories
  const fontsDir = path.join(ROOT, 'fonts');
  const packsDir = path.join(ROOT, 'packs');
  fs.mkdirSync(fontsDir, { recursive: true });
  fs.mkdirSync(path.join(packsDir, 'pjsk'), { recursive: true });
  fs.mkdirSync(path.join(packsDir, 'arcaea'), { recursive: true });

  // 2. Download YurukaFangTang font
  const fontPath = path.join(fontsDir, 'YurukaFangTang.ttf');
  if (!fs.existsSync(fontPath) || fs.statSync(fontPath).size < 1000000) {
    console.log('1. Downloading primary font (YurukaFangTang.ttf)...');
    const fontBuf = await fetchWithFallback('_shared/YurukaFangTang.ttf');
    fs.writeFileSync(fontPath, fontBuf);
  } else {
    console.log('1. Primary font (YurukaFangTang.ttf) already exists.');
  }

  // 2.5 Download Emoji font
  const emojiPath = path.join(fontsDir, 'NotoColorEmoji.ttf');
  if (!fs.existsSync(emojiPath) || fs.statSync(emojiPath).size < 1000000) {
    console.log('\n1.5 Downloading Emoji font (NotoColorEmoji.ttf)...');
    const emojiUrl = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2020-09-16-unicode13_1/fonts/NotoColorEmoji.ttf';
    try {
      const res = await fetch(emojiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(emojiPath, buf);
        console.log(`✓ Success: NotoColorEmoji.ttf (${(buf.length / (1024 * 1024)).toFixed(2)} MB)`);
      }
    } catch (e) {
      console.warn('  Failed to download NotoColorEmoji.ttf:', e.message);
    }
  } else {
    console.log('1.5 Emoji font (NotoColorEmoji.ttf) already exists.');
  }

  // 3. Download PJSK full manifest
  console.log('\n2. Downloading full PJSK manifest (359 stickers)...');
  const pjskBuf = await fetchWithFallback('pjsk/manifest.json');
  fs.writeFileSync(path.join(packsDir, 'pjsk', 'manifest.json'), pjskBuf);

  // 4. Download Arcaea full manifest
  console.log('\n3. Downloading full Arcaea manifest (21 stickers)...');
  const arcaeaBuf = await fetchWithFallback('arcaea/manifest.json');
  fs.writeFileSync(path.join(packsDir, 'arcaea', 'manifest.json'), arcaeaBuf);

  console.log('\n🎉 Asset sync completed successfully!');
}

main().catch(err => {
  console.error('\n❌ Sync failed:', err);
  process.exit(1);
});
