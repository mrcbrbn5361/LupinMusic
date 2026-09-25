// Yerel onizleme sunucusu: dist statik + /party SSR (deploy birebir ayni)
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const party = require('./api/party.js');

const ROOT = fs.existsSync(path.join(__dirname, 'dist')) ? path.join(__dirname, 'dist') : __dirname;
const PORT = Number(process.env.PORT) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  let p = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
  if (!p.startsWith(ROOT)) { res.statusCode = 403; return res.end('Forbidden'); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', MIME[path.extname(p).toLowerCase()] || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/party') {
    const query = Object.fromEntries(url.searchParams.entries());
    return party({ query }, res);
  }
  if (url.pathname === '/health') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ status: 'ok' }));
  }
  let pathname = url.pathname;
  if (!path.extname(pathname) && !fs.existsSync(path.join(ROOT, pathname))) pathname += '.html';
  return serveStatic(req, res, pathname);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Lupin site onizleme: http://127.0.0.1:${PORT} (root: ${path.basename(ROOT)})`);
});
