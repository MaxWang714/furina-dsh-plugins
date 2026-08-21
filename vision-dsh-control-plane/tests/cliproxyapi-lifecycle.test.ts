import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { startSidecar, waitForSidecar } from '../integrations/cliproxyapi/lifecycle.mjs';

describe('CLIProxyAPI lifecycle', () => {
  it('authenticates the readiness probe without returning the key', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer local-only-key');
      return new Response('{"object":"list","data":[]}', { status: 200 });
    });

    const result = await waitForSidecar({
      baseUrl: 'http://127.0.0.1:8317',
      apiKey: 'local-only-key',
      timeoutMs: 100,
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, status: 200, url: 'http://127.0.0.1:8317' });
    expect(JSON.stringify(result)).not.toContain('local-only-key');
  });

  it('preserves an explicit authorization header', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Custom existing');
      return new Response('{}', { status: 200 });
    });

    await waitForSidecar({
      apiKey: 'ignored-key',
      headers: { Authorization: 'Custom existing' },
      timeoutMs: 100,
      fetchImpl,
    });
  });

  it('passes an explicit upstream proxy to the hidden sidecar process', () => {
    const child = { killed: false } as ChildProcess;
    const calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
    const spawnImpl = (command: string, args: readonly string[], options: SpawnOptions) => {
      calls.push({ command, args, options });
      return child;
    };
    const result = startSidecar({
      executable: 'cliproxyapi.exe',
      upstreamProxyUrl: 'http://127.0.0.1:7890',
      env: { HTTPS_PROXY: 'http://override.invalid:1' },
      spawnImpl,
    });

    expect(result).toBe(child);
    const options = calls[0]?.options;
    expect(options?.windowsHide).toBe(true);
    expect(options?.shell).toBe(false);
    expect(options?.env?.HTTP_PROXY).toBe('http://127.0.0.1:7890');
    expect(options?.env?.HTTPS_PROXY).toBe('http://override.invalid:1');
    expect(options?.env?.ALL_PROXY).toBe('http://127.0.0.1:7890');
  });
});
