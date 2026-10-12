import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../apps/mobile/dist/', import.meta.url));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};
const server = createServer(async (req, res) => {
  try {
    const path = resolve(
      root,
      '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname),
    );
    if (path !== resolve(root) && !path.startsWith(resolve(root) + sep)) {
      res.writeHead(403).end();
      return;
    }
    let file = path;
    try {
      if (!(await stat(path)).isFile()) file = resolve(root, 'index.html');
    } catch {
      file = resolve(root, 'index.html');
    }
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res
      .writeHead(500, { 'Content-Type': 'text/plain' })
      .end('Run npm run export:web first.');
  }
});
server.listen(Number(process.env.PREVIEW_PORT ?? 8082), '127.0.0.1', () =>
  console.log(
    'FitMind preview: http://127.0.0.1:' + (process.env.PREVIEW_PORT ?? 8082),
  ),
);
