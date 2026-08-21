import { spawn } from 'node:child_process';

export function sidecarUrl({ host = '127.0.0.1', port = 8317 } = {}) {
  return `http://${host}:${port}`;
}

export async function waitForSidecar({ baseUrl = sidecarUrl(), timeoutMs = 15000, intervalMs = 250, fetchImpl = fetch } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'not attempted';
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/models`, { headers: { accept: 'application/json' } });
      if (response.ok) return { ok: true, status: response.status, url: baseUrl };
      lastError = `HTTP ${response.status}`;
    } catch (error) { lastError = error?.message ?? String(error); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ok: false, url: baseUrl, error: lastError };
}

export function startSidecar({ executable, configPath, args = [], cwd, env = {}, spawnImpl = spawn } = {}) {
  if (!executable) throw new TypeError('CLIProxyAPI executable is required');
  const child = spawnImpl(executable, [...(configPath ? ['-config', configPath] : []), ...args], {
    cwd,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  return child;
}

export function stopSidecar(child, signal = 'SIGTERM') {
  if (!child || child.killed) return false;
  return child.kill(signal);
}
