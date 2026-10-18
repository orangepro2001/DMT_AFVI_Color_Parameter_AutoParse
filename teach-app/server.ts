import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export interface ModelInfo {
  id: string;
  host: 'FM1' | 'FM2' | 'BM';
  model: string;
  side: 'TOP' | 'BOTTOM';
  version: string;
  files: { metal: string; sr: string; open: string; median: string; pattern: string | null };
  alignSpec: string | null;
}

const HOSTS: Array<'FM1' | 'FM2' | 'BM'> = ['FM1', 'FM2', 'BM'];

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

function normalizeModelKey(name: string): string {
  let s = name.toUpperCase();
  if (s.endsWith('-00')) s = s.slice(0, -3);
  return s;
}

async function findAlignSpec(repoRoot: string, host: string, model: string, side: 'TOP' | 'BOTTOM'): Promise<string | null> {
  const specRoot = path.join(repoRoot, 'reference', host, 'PxInventory', 'INSPECT_SPEC');
  const dirs = await listDirs(specRoot);
  const target = normalizeModelKey(model);
  for (const dir of dirs) {
    if (normalizeModelKey(dir) !== target) continue;
    const candidate = path.join(specRoot, dir, side, 'AlignSpec.xml');
    if (await fileExists(candidate)) {
      return toPosix(path.relative(path.join(repoRoot, 'reference'), candidate));
    }
  }
  return null;
}

async function findVersionWithMedian(modelDir: string, side: 'TOP' | 'BOTTOM', preferred: string): Promise<string | null> {
  const versions = await listDirs(modelDir);
  const hasMedian = async (v: string): Promise<boolean> =>
    fileExists(path.join(modelDir, v, 'Line', side, 'Layer', 'MEDIAN', 'Median_0_1_0.tif'));
  if (versions.includes(preferred) && (await hasMedian(preferred))) return preferred;
  for (const v of versions) {
    if (await hasMedian(v)) return v;
  }
  return null;
}

async function scanModels(repoRoot: string): Promise<ModelInfo[]> {
  const refRoot = path.join(repoRoot, 'reference');
  const out: ModelInfo[] = [];
  for (const host of HOSTS) {
    const hostDir = path.join(refRoot, host);
    if (!existsSync(hostDir)) continue;
    const repoDir = path.join(hostDir, 'PxRepository');
    const models = await listDirs(repoDir);
    for (const model of models) {
      const modelDir = path.join(repoDir, model);
      const metal = path.join(modelDir, 'Metal.tif');
      const sr = path.join(modelDir, 'SR.tif');
      const open = path.join(modelDir, 'Open.tif');
      if (!(await fileExists(metal)) || !(await fileExists(sr)) || !(await fileExists(open))) continue;
      const side: 'TOP' | 'BOTTOM' = host === 'BM' ? 'BOTTOM' : 'TOP';
      const preferred = host === 'BM' ? '3.5' : '2.0';
      const version = await findVersionWithMedian(modelDir, side, preferred);
      if (version === null) continue;
      const medianAbs = path.join(modelDir, version, 'Line', side, 'Layer', 'MEDIAN', 'Median_0_1_0.tif');
      const patternAbs = path.join(modelDir, version, 'Line', side, 'Layer', 'GB', 'Pattern.tif');
      const pattern = (await fileExists(patternAbs))
        ? toPosix(path.relative(refRoot, patternAbs))
        : null;
      const alignSpec = await findAlignSpec(repoRoot, host, model, side);
      out.push({
        id: `${host}/${model}`,
        host,
        model,
        side,
        version,
        files: {
          metal: toPosix(path.relative(refRoot, metal)),
          sr: toPosix(path.relative(refRoot, sr)),
          open: toPosix(path.relative(refRoot, open)),
          median: toPosix(path.relative(refRoot, medianAbs)),
          pattern,
        },
        alignSpec,
      });
    }
  }
  return out;
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function serveStrippedTs(res: ServerResponse, absPath: string): Promise<void> {
  let source: string;
  try {
    source = await readFile(absPath, 'utf8');
  } catch {
    sendText(res, 404, `not found: ${absPath}`);
    return;
  }
  let js: string;
  try {
    js = stripTypeScriptTypes(source, { mode: 'strip' });
  } catch (err) {
    sendText(res, 500, `strip failed: ${(err as Error).message}`);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(js);
}

function contentTypeFor(absPath: string): string {
  const ext = path.extname(absPath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

async function serveFile(res: ServerResponse, absPath: string): Promise<void> {
  let data: Buffer;
  try {
    data = await readFile(absPath);
  } catch {
    sendText(res, 404, 'not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': contentTypeFor(absPath), 'Cache-Control': 'no-store' });
  res.end(data);
}

export async function startServer(port: number, repoRoot: string): Promise<{ port: number; close(): Promise<void> }> {
  const publicDir = path.join(repoRoot, 'teach-app', 'public');
  const appSrcDir = path.join(repoRoot, 'teach-app', 'src');
  const coreSrcDir = path.join(repoRoot, 'teach-core', 'src');
  const refDir = path.join(repoRoot, 'reference');

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'method not allowed');
        return;
      }

      if (pathname === '/' || pathname === '/index.html') {
        await serveFile(res, path.join(publicDir, 'index.html'));
        return;
      }
      if (pathname === '/styles.css') {
        await serveFile(res, path.join(publicDir, 'styles.css'));
        return;
      }

      if (pathname.startsWith('/teach-app/src/') || pathname.startsWith('/teach-core/src/')) {
        const isApp = pathname.startsWith('/teach-app/src/');
        const baseDir = isApp ? appSrcDir : coreSrcDir;
        const prefix = isApp ? '/teach-app/src/' : '/teach-core/src/';
        const rel = pathname.slice(prefix.length);
        if (!rel.endsWith('.ts')) {
          sendText(res, 403, 'only .ts modules are served');
          return;
        }
        const abs = path.resolve(baseDir, rel);
        if (!isInside(baseDir, abs)) {
          sendText(res, 403, 'path escapes module root');
          return;
        }
        await serveStrippedTs(res, abs);
        return;
      }

      if (pathname === '/api/models') {
        const models = await scanModels(repoRoot);
        sendJson(res, 200, models);
        return;
      }

      if (pathname === '/api/file') {
        const rel = url.searchParams.get('path');
        if (rel === null || rel.length === 0) {
          sendText(res, 400, 'missing path');
          return;
        }
        const ext = path.extname(rel).toLowerCase();
        if (ext !== '.tif' && ext !== '.tiff' && ext !== '.xml') {
          sendText(res, 403, `extension not allowed: ${ext}`);
          return;
        }
        const abs = path.resolve(refDir, rel);
        if (!isInside(refDir, abs)) {
          sendText(res, 403, 'path escapes reference root');
          return;
        }
        await serveFile(res, abs);
        return;
      }

      sendText(res, 404, `not found: ${pathname}`);
    } catch (err) {
      sendText(res, 500, `server error: ${(err as Error).message}`);
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    port: actualPort,
    close(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

const isDirectRun = (() => {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(argv1);
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const port = Number(process.env.TEACH_PORT ?? '5178');
  startServer(Number.isFinite(port) ? port : 5178, repoRoot)
    .then((s) => {
      console.log(`AFVI teach app: http://127.0.0.1:${s.port}/`);
    })
    .catch((err: unknown) => {
      console.error(`failed to start: ${(err as Error).message}`);
      process.exitCode = 1;
    });
}
