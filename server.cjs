// Serve only the application's public files, never arbitrary workspace files.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = fs.realpathSync(__dirname);
const publicFiles = new Set(['index.html', 'assets/css/app.css', 'assets/js/model.js', 'assets/js/lattice.js', 'assets/js/map.js', 'assets/js/app.js', 'assets/js/reference.js']);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!publicFiles.has(name)) { res.writeHead(404); res.end('Not found'); return; }
  const file = fs.realpathSync(path.join(root, name));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(8000, '127.0.0.1', () => console.log('RIXS Cut Planner: http://127.0.0.1:8000'));
