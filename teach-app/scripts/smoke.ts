import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.ts';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail.length > 0 ? ` — ${detail}` : ''}`);
}

async function fetchText(url: string): Promise<{ status: number; text: string; contentType: string }> {
  const res = await fetch(url);
  const text = await res.text();
  return { status: res.status, text, contentType: res.headers.get('content-type') ?? '' };
}

async function fetchBytes(url: string): Promise<{ status: number; bytes: number }> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return { status: res.status, bytes: buf.byteLength };
}

function collectImports(source: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const spec = m[1];
    if (spec.startsWith('.')) out.push(spec);
  }
  return out;
}

function resolveModule(fromUrl: string, spec: string): string {
  const base = fromUrl.slice(0, fromUrl.lastIndexOf('/') + 1);
  const parts = (base + spec).split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return '/' + stack.join('/');
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const server = await startServer(0, repoRoot);
  const base = `http://127.0.0.1:${server.port}`;
  const tempDir = await mkdtemp(path.join(tmpdir(), 'teach-smoke-'));

  try {
    const index = await fetchText(`${base}/`);
    record('GET / 返回 200', index.status === 200, `status=${index.status}`);
    record('GET / 包含 main.ts 引用', index.text.includes('/teach-app/src/main.ts'));

    const css = await fetchText(`${base}/styles.css`);
    record('GET /styles.css 返回 200', css.status === 200, `status=${css.status}`);

    const visited = new Set<string>();
    const queue: string[] = ['/teach-app/src/main.ts', '/teach-app/src/worker.ts'];
    const modules: Array<{ url: string; source: string }> = [];
    while (queue.length > 0) {
      const url = queue.shift() as string;
      if (visited.has(url)) continue;
      visited.add(url);
      const res = await fetchText(`${base}${url}`);
      if (res.status !== 200) {
        record(`模块 ${url} 返回 200`, false, `status=${res.status}`);
        continue;
      }
      if (!res.contentType.includes('text/javascript')) {
        record(`模块 ${url} Content-Type`, false, res.contentType);
      }
      modules.push({ url, source: res.text });
      for (const spec of collectImports(res.text)) {
        const resolved = resolveModule(url, spec);
        if (!visited.has(resolved)) queue.push(resolved);
      }
    }
    record(`抓取模块数量 ${modules.length}`, modules.length > 0);

    let syntaxOk = true;
    for (const mod of modules) {
      const fileName = mod.url.replace(/[^a-zA-Z0-9._-]/g, '_') + '.mjs';
      const filePath = path.join(tempDir, fileName);
      await writeFile(filePath, mod.source, 'utf8');
      const check = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' });
      if (check.status !== 0) {
        syntaxOk = false;
        record(`语法检查 ${mod.url}`, false, (check.stderr || check.stdout).trim().slice(0, 400));
      }
    }
    record('全部模块语法检查通过', syntaxOk);

    const modelsRes = await fetch(`${base}/api/models`);
    const models = (await modelsRes.json()) as Array<{ files: { median: string } }>;
    record('GET /api/models 至少 1 个', Array.isArray(models) && models.length >= 1, `count=${models.length}`);
    if (models.length >= 1) {
      const median = await fetchBytes(`${base}/api/file?path=${encodeURIComponent(models[0].files.median)}`);
      record('MEDIAN 可下载且 > 1MB', median.status === 200 && median.bytes > 1_000_000, `bytes=${median.bytes}`);
    }

    const escape1 = await fetchText(`${base}/api/file?path=../package.json`);
    record('越界 ../package.json 被拒', escape1.status === 403, `status=${escape1.status}`);
    const escape2 = await fetchText(`${base}/teach-core/src/../../package.json`);
    record('越界 /teach-core/src/../../package.json 被拒', escape2.status === 403 || escape2.status === 404, `status=${escape2.status}`);
    const escape3 = await fetchText(`${base}/api/file?path=x.txt`);
    record('非允许扩展名被拒', escape3.status === 403, `status=${escape3.status}`);
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
  if (failed.length > 0) process.exitCode = 1;
}

void main();
