/*
 * Local / always-on server: serves public/ and the API.
 * (On Vercel this file is not used — see api/index.js and vercel.json.)
 *
 * Run:  npm start      → http://localhost:3000  and  http://localhost:3000/main
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleApi, storeKind, paymentProvider } = require('./api');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/main') p = '/main/index.html';
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('לא נמצא');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    if (req.url.startsWith('/api/')) return handleApi(req, res);
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
    res.writeHead(405);
    res.end();
  })
  .listen(PORT, () => {
    console.log(`☕  Ordering site:   http://localhost:${PORT}/`);
    console.log(`📋  Staff dashboard: http://localhost:${PORT}/main`);
    console.log(`💾  Storage: ${storeKind}  |  💳 Payment: ${paymentProvider}${process.env.ADMIN_PIN ? '  |  🔒 PIN on' : ''}`);
  });
