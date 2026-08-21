import { spawn } from 'node:child_process';

export function sidecarUrl({ host = '127.0.0.1', port = 8317 } = {}) {
  return `http://${host}:${port}`;
}

function healthHeaders(headers, apiKey) {
  const result = { accept: 'application/json', ...headers };
  const hasAuthorization = Object.keys(result).some((key) => key.toLowerCase() === 'authorization');
  if (apiKey && !hasAuthorization) result.authorization = `Bearer ${apiKey}`;
  return result;
}

export async function waitForSidecar({ baseUrl = sidecarUrl(), apiKey, headers, timeoutMs = 15000, intervalMs = 250, fetchImpl = fetch } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'not attempted';
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/models`, {
        headers: healthHeaders(headers, apiKey),
      });
      if (response.ok) return { ok: true, status: response.status, url: baseUrl };
      lastError = `HTTP ${response.status}`;
    } catch (error) { lastError = error?.message ?? String(error); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ok: false, url: baseUrl, error: lastError };
}

export function startSidecar({ executable, configPath, args = [], cwd, env = {}, upstreamProxyUrl, spawnImpl = spawn } = {}) {
  if (!executable) throw new TypeError('CLIProxyAPI executable is required');
  const proxyEnv = upstreamProxyUrl ? {
    HTTP_PROXY: upstreamProxyUrl,
    HTTPS_PROXY: upstreamProxyUrl,
    ALL_PROXY: upstreamProxyUrl,
  } : {};
  const child = spawnImpl(executable, [...(configPath ? ['-config', configPath] : []), ...args], {
    cwd,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...proxyEnv, ...env },
  });
  return child;
}

export function stopSidecar(child, signal = 'SIGTERM') {
  if (!child || child.killed) return false;
  return child.kill(signal);
}
