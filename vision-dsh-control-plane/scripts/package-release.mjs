import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.env.RELEASE_DIR ?? join(root, '..', 'release', 'vision-codex-unified-product-v1'));
const releaseVersion = process.env.RELEASE_VERSION ?? '0.1.0-rc.1';
const sourceTag = process.env.SOURCE_TAG ?? null;
const sourceCommit = process.env.SOURCE_COMMIT ?? null;
await mkdir(out, { recursive: true });
async function copyIf(source, target) { try { await cp(resolve(root, source), join(out, target), { recursive: true, force: true, filter: (path) => !path.includes('node_modules') && !path.includes(`${join('vendor', 'CLIProxyAPI', 'auths')}`) && !path.includes(`${join('vendor', 'CLIProxyAPI', 'release')}`) }); return true; } catch { return false; } }
await copyIf('dist', 'dist');
await copyIf('target/x86_64-pc-windows-gnu/release/visiond.exe', 'bin/visiond.exe');
await copyIf('target/x86_64-pc-windows-gnu/release/vision-desktop.exe', 'bin/vision-desktop.exe');
try { const sidecarBinary = process.env.CLIPROXYAPI_BIN; if (sidecarBinary) { await mkdir(join(out, 'optional'), { recursive: true }); await cp(resolve(sidecarBinary), join(out, 'optional/cliproxyapi.exe'), { force: true }); } } catch { /* optional sidecar binary may be unavailable */ }
await copyIf('integrations/cliproxyapi/sidecar-manifest.json', 'optional/sidecar-manifest.json');
await copyIf('integrations/cliproxyapi/config.example.yaml', 'optional/config.example.yaml');
await copyIf('integrations/cliproxyapi/README.md', 'optional/README.md');
await copyIf('integrations/cliproxyapi/CLIProxyAPI-LICENSE', 'optional/CLIProxyAPI-LICENSE');
await copyIf('integrations/cliproxyapi/dsh-provider', 'plugins/dsh-cliproxyapi-provider');
await copyIf('plugins/dsh-observability', 'plugins/dsh-observability');
await copyIf('plugins/furina-codex-provider', 'plugins/furina-codex-provider');
await copyIf('README.md', 'README.md');
await copyIf('THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md');
await copyIf('docs', 'docs');
await copyIf('packaging', 'packaging');
const files = [];
async function walk(dir, relative = '') { for (const entry of await readdir(dir, { withFileTypes: true })) { const rel = join(relative, entry.name); const full = join(dir, entry.name); if (entry.isDirectory()) await walk(full, rel); else { const bytes = await (await import('node:fs/promises')).readFile(full); files.push({ path: rel.replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); } } }
await walk(out);
await writeFile(join(out, 'release-manifest.json'), JSON.stringify({ schema_version: '1.0.0', product: 'Vision + Codex Unified Product', version: releaseVersion, source_tag: sourceTag, source_commit: sourceCommit, signed: false, unsigned_disclosure: 'This release candidate is unsigned; Windows SmartScreen may warn.', codex_direct_default: false, cliproxyapi_default: false, generated_at: new Date().toISOString(), files }, null, 2));
const sums = files.map((file) => `${file.sha256}  ${file.path}`).join('\n') + '\n';
await writeFile(join(out, 'SHA256SUMS'), sums, 'utf8');
console.log(JSON.stringify({ release_dir: out, file_count: files.length, unsigned: true }));
