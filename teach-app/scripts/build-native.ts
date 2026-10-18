import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const nativeDir = path.join(repoRoot, 'teach-app', 'native');
const webDir = path.join(nativeDir, 'web');
const publicDir = path.join(repoRoot, 'teach-app', 'public');
const appSrcDir = path.join(repoRoot, 'teach-app', 'src');
const coreSrcDir = path.join(repoRoot, 'teach-core', 'src');

const webOnly = process.argv.includes('--web-only');

function copyFile(src: string, dest: string): void {
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(src));
}

function stripDir(srcDir: string, destDir: string): number {
  let count = 0;
  let entries: string[];
  try {
    entries = readdirSync(srcDir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (!name.endsWith('.ts')) continue;
    const src = path.join(srcDir, name);
    if (!statSync(src).isFile()) continue;
    const source = readFileSync(src, 'utf8');
    const js = stripTypeScriptTypes(source, { mode: 'strip' });
    const dest = path.join(destDir, name);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, js);
    count += 1;
  }
  return count;
}

function buildWeb(): void {
  rmSync(webDir, { recursive: true, force: true });
  mkdirSync(webDir, { recursive: true });
  copyFile(path.join(publicDir, 'index.html'), path.join(webDir, 'index.html'));
  copyFile(path.join(publicDir, 'styles.css'), path.join(webDir, 'styles.css'));
  const appCount = stripDir(appSrcDir, path.join(webDir, 'teach-app', 'src'));
  const coreCount = stripDir(coreSrcDir, path.join(webDir, 'teach-core', 'src'));
  console.log(`web: ${appCount} teach-app modules, ${coreCount} teach-core modules`);
}

function buildExe(): void {
  const distDir = path.join(nativeDir, 'dist');
  mkdirSync(distDir, { recursive: true });
  const out = path.join(distDir, 'ColorAfviTeach.exe');
  const env = { ...process.env, GOPROXY: 'off', GOFLAGS: '-mod=readonly' };
  const result = spawnSync(
    'go',
    ['build', '-trimpath', '-ldflags', '-s -w -H windowsgui', '-o', out, '.'],
    { cwd: nativeDir, env, stdio: 'inherit', shell: false },
  );
  if (result.error !== undefined) {
    console.error(`go build failed: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }
  if (result.status !== 0) {
    console.error(`go build failed with exit code ${result.status}`);
    process.exitCode = 1;
    return;
  }
  const size = statSync(out).size;
  console.log(`exe: ${out} (${size} bytes)`);
}

buildWeb();
if (!webOnly) {
  buildExe();
}
