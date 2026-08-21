import type { ChildProcess, SpawnOptions } from 'node:child_process';

export interface SidecarAddress {
  host?: string;
  port?: number;
}

export interface SidecarReadinessOptions {
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
}

export interface SidecarStartOptions {
  executable: string;
  configPath?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  upstreamProxyUrl?: string;
  spawnImpl?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
}

export function sidecarUrl(options?: SidecarAddress): string;
export function waitForSidecar(options?: SidecarReadinessOptions): Promise<
  | { ok: true; status: number; url: string }
  | { ok: false; url: string; error: string }
>;
export function startSidecar(options: SidecarStartOptions): ChildProcess;
export function stopSidecar(child: ChildProcess | undefined, signal?: NodeJS.Signals): boolean;
