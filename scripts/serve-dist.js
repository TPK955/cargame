import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createServer } from 'node:http';

const DIST_DIR = join(process.cwd(), 'dist');
const DEFAULT_PORT = 4173;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

function resolvePath(urlPath) {
  const pathOnly = (urlPath || '/').split('?')[0].split('#')[0];
  const normalized = normalize(pathOnly).replace(/^([.][.][/\\])+/, '');
  return normalized.startsWith('/') ? normalized.slice(1) : normalized;
}

function sendFile(res, absolutePath) {
  const ext = extname(absolutePath).toLowerCase();
  const type = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(absolutePath).pipe(res);
}

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function sendServerError(res) {
  res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Internal server error');
}

export function serveDist() {
  if (!existsSync(DIST_DIR)) {
    console.error('dist directory is missing. Run npm run build first.');
    process.exit(1);
  }

  const port = Number.parseInt(process.env.PORT || '', 10) || DEFAULT_PORT;

  const server = createServer((req, res) => {
    try {
      const relativePath = resolvePath(req.url);
      const requestedPath = join(DIST_DIR, relativePath || 'index.html');

      if (existsSync(requestedPath) && statSync(requestedPath).isFile()) {
        sendFile(res, requestedPath);
        return;
      }

      // SPA fallback for client-side routes.
      const indexPath = join(DIST_DIR, 'index.html');
      if (existsSync(indexPath)) {
        sendFile(res, indexPath);
        return;
      }

      sendNotFound(res);
    } catch (error) {
      console.error(error);
      sendServerError(res);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Serving dist on http://0.0.0.0:${port}`);
  });
}
