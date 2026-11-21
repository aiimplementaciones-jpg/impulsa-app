// Renderiza piezas HTML a PNG exacto con Chrome headless.
// Uso:  node render.js 01-dolor-4x5 [02-...]
// Sirve la carpeta piezas/ por HTTP para que las fuentes y el SVG carguen sin CORS.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const CHROME = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
};

const server = http.createServer((req, res) => {
  const clean = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, clean);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('404');
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
  });
  fs.createReadStream(file).pipe(res);
});

const names = process.argv.slice(2);
if (!names.length) { console.error('Falta el nombre de la pieza'); process.exit(1); }

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  let fail = 0;
  for (const name of names) {
    const html = `piezas/${name}.html`;
    const out = path.join(ROOT, 'salida', `${name}.png`);
    if (!fs.existsSync(path.join(ROOT, html))) { console.error('no existe ' + html); fail++; continue; }
    const fileUrl = 'file:///' + path.join(ROOT, html).replace(/\\/g, '/');
    const args = [
      '--headless', '--disable-gpu', '--hide-scrollbars',
      '--allow-file-access-from-files',
      '--force-device-scale-factor=1', '--window-size=1080,1350',
      `--screenshot=${out}`, fileUrl,
    ];
    const r = spawnSync(CHROME, args, { encoding: 'utf8', timeout: 30000, stdio: 'ignore' });
    if (!fs.existsSync(out)) {
      console.error(`${name}: fallo | code=${r.status} signal=${r.signal}\nerr: ${r.error ? r.error.message : ''}\nstdout: ${r.stdout || ''}\nstderr: ${r.stderr || ''}`);
      fail++;
    }
    else console.log(`${name}.png  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
  }
  server.close(() => process.exit(fail ? 1 : 0));
});
