import http from 'http';
import { handleRequest } from './src/app.js';

const PORT = process.env.PORT || 3000;

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Meme Stickers Serverless (Node.js Route A) Running!`);
  console.log(`📍 Web Playground: http://localhost:${PORT}`);
  console.log(`⚡ API Generate:   http://localhost:${PORT}/api/generate`);
  console.log(`📊 API Packs:      http://localhost:${PORT}/api/packs`);
  console.log(`======================================================\n`);
});

// Export handler for serverless compatibility
export default handleRequest;
