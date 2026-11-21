import { renderSticker } from '../src/renderer.js';
import fs from 'fs';
import path from 'path';

async function run() {
  console.log('Testing renderSticker with empty text...');
  const res1 = await renderSticker({ width: 200, height: 200 });
  console.log('Res1 buffer length:', res1.buffer.length);

  console.log('Testing renderSticker with text and rotation...');
  const res2 = await renderSticker({
    width: 296,
    height: 256,
    text: '测试文本 123 Keep Up!',
    textX: 148,
    textY: 100,
    textRotateDegrees: -15,
    textColor: [251, 138, 172, 255],
    strokeColor: [255, 255, 255, 255],
    strokeWidthFactor: 0.2,
    fontSize: 36,
  });
  console.log('Res2 buffer length:', res2.buffer.length);

  console.log('Testing o/g loop inner fill (no transparent holes in center)...');
  const res3 = await renderSticker({
    width: 200,
    height: 100,
    text: 'goog',
    textX: 100,
    textY: 50,
    fontSize: 48,
    strokeWidthFactor: 0.18,
    strokeColor: [255, 255, 255, 255],
    textColor: [244, 63, 94, 255],
  });
  console.log('Res3 buffer length:', res3.buffer.length);

  const outDir = path.resolve('test/output');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'test_sticker.png'), res2.buffer);
  fs.writeFileSync(path.join(outDir, 'test_goog.png'), res3.buffer);
  console.log('Saved test sticker to test/output/test_sticker.png');
}

run().catch(console.error);
