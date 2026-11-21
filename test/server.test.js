import { handleRequest } from '../src/app.js';
import { EventEmitter } from 'events';

// Create mock HTTP request and response
function createMockHttp({ method = 'GET', url = '/', body = null, headers = {} }) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost:3000', ...headers };

  let statusCode = 200;
  let headersSent = {};
  let dataChunks = [];
  let isFinished = false;

  const resPromise = new Promise((resolve, reject) => {
    const res = {
      writeHead(code, h = {}) {
        statusCode = code;
        headersSent = { ...headersSent, ...h };
      },
      setHeader(k, v) {
        headersSent[k] = v;
      },
      write(chunk) {
        dataChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      },
      end(chunk) {
        if (chunk) {
          dataChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        isFinished = true;
        const totalBuffer = Buffer.concat(dataChunks);
        resolve({
          statusCode,
          headers: headersSent,
          bodyBuffer: totalBuffer,
          bodyText: totalBuffer.toString('utf-8'),
        });
      },
    };

    // Run handler
    handleRequest(req, res).catch(reject);

    // Feed body if any
    if (body) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.emit('data', Buffer.from(payload));
    }
    req.emit('end');
  });

  return resPromise;
}

async function runTests() {
  console.log('--- 1. Testing GET / (HTML Playground) ---');
  const r1 = await createMockHttp({ method: 'GET', url: '/' });
  console.log('Status:', r1.statusCode);
  console.log('Content-Type:', r1.headers['Content-Type']);
  if (!r1.bodyText.includes('pjsk贴纸制作')) {
    throw new Error('GET / did not contain "pjsk贴纸制作"');
  }
  console.log('✅ GET / returned playground HTML successfully!');

  console.log('\n--- 2. Testing GET /api/status ---');
  const r2 = await createMockHttp({ method: 'GET', url: '/api/status' });
  console.log('Status:', r2.statusCode);
  const j2 = JSON.parse(r2.bodyText);
  console.log('Status JSON:', j2);
  if (j2.engine !== '@napi-rs/canvas') throw new Error('Engine mismatch');
  console.log('✅ GET /api/status verified!');

  console.log('\n--- 3. Testing GET /api/packs ---');
  const r3 = await createMockHttp({ method: 'GET', url: '/api/packs' });
  console.log('Status:', r3.statusCode);
  const j3 = JSON.parse(r3.bodyText);
  if (!j3.data.pjsk) throw new Error('PJSK pack missing');
  console.log('Packs found:', Object.keys(j3.data));
  console.log('✅ GET /api/packs verified!');

  console.log('\n--- 4. Testing POST /api/generate ---');
  const r4 = await createMockHttp({
    method: 'POST',
    url: '/api/generate',
    body: {
      pack_slug: 'pjsk',
      sticker_name: 'Airi 01',
      text: '加油！Keep Up!',
      font_size: 44,
      image_format: 'png',
    },
  });
  console.log('Status:', r4.statusCode);
  const j4 = JSON.parse(r4.bodyText);
  if (j4.status !== 'ok' || !j4.data.data_uri.startsWith('data:image/png;base64,')) {
    throw new Error('Generate failed: ' + JSON.stringify(j4));
  }
  console.log('Generated sticker width:', j4.data.width, 'height:', j4.data.height, 'size:', j4.data.size_bytes);
  console.log('✅ POST /api/generate verified!');

  console.log('\n--- 4.1 Testing POST /api/generate with text_align (left vs right) ---');
  const rLeft = await createMockHttp({
    method: 'POST',
    url: '/api/generate',
    body: {
      pack_slug: 'pjsk',
      sticker_name: 'Airi 01',
      text: '对齐测试 Align',
      text_align: 'left',
      auto_resize: false,
    },
  });
  const rRight = await createMockHttp({
    method: 'POST',
    url: '/api/generate',
    body: {
      pack_slug: 'pjsk',
      sticker_name: 'Airi 01',
      text: '对齐测试 Align',
      text_align: 'right',
      auto_resize: false,
    },
  });
  const jLeft = JSON.parse(rLeft.bodyText);
  const jRight = JSON.parse(rRight.bodyText);
  if (jLeft.data.data_uri === jRight.data.data_uri) {
    throw new Error('Left and right aligned stickers produced identical output!');
  }
  console.log('✅ text_align left vs right produced distinct aligned outputs!');

  console.log('\n--- 5. Testing GET /api/generate (Direct Binary Stream) ---');
  const r5 = await createMockHttp({
    method: 'GET',
    url: '/api/generate?pack=pjsk&sticker=Airi%2001&text=%E5%A4%A7%E6%88%90%E5%8A%9F&format=png',
  });
  console.log('Status:', r5.statusCode);
  console.log('Content-Type:', r5.headers['Content-Type']);
  console.log('Binary image size:', r5.bodyBuffer.length, 'bytes');
  if (r5.headers['Content-Type'] !== 'image/png' || r5.bodyBuffer.length < 1000) {
    throw new Error('Binary image response invalid');
  }
  console.log('✅ GET /api/generate verified!');

  console.log('\n--- 5.1 Testing GET /api/generate with Custom Color & Formatting Query Parameters ---');
  const rCustom = await createMockHttp({
    method: 'GET',
    url: '/api/generate?pack=pjsk&sticker=Airi%2001&text=ColorTest&color=%23FF0000&stroke=%23000000&size=55&rotate=12&stroke_width=0.3&x=130&y=70&align=left&format=png',
  });
  console.log('Custom GET status:', rCustom.statusCode, 'size:', rCustom.bodyBuffer.length);
  if (rCustom.statusCode !== 200 || rCustom.bodyBuffer.length < 1000) {
    throw new Error('Custom parameters GET /api/generate failed');
  }
  console.log('✅ Custom GET /api/generate with color and layout parameters verified!');

  console.log('\n--- 6. Testing GET /fonts/YurukaFangTang.ttf ---');
  const r6 = await createMockHttp({
    method: 'GET',
    url: '/fonts/YurukaFangTang.ttf',
  });
  console.log('Status:', r6.statusCode);
  console.log('Content-Type:', r6.headers['Content-Type']);
  console.log('Font file size:', r6.bodyBuffer.length, 'bytes');
  if (r6.statusCode !== 200 || r6.bodyBuffer.length < 1000000) {
    throw new Error('Font file response invalid');
  }
  console.log('✅ GET /fonts/YurukaFangTang.ttf verified!');

  console.log('\n🎉 ALL INTEGRATION TESTS PASSED PERFECTLY!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
