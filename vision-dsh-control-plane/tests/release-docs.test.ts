import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

async function text(path: string) {
  return readFile(resolve(root, path), 'utf8');
}

describe('release documentation and payload contract', () => {
  it('describes the real Codex generation boundary instead of catalog-only success', async () => {
    const readme = await text('../README.md');
    const notes = await text('docs/release-notes-rc1.md');
    expect(readme).toContain('POST /v1/responses');
    expect(notes).toContain('0.2.0-rc.1');
    expect(notes).toContain('真实 `/v1/models`、非流式 `/v1/responses`、SSE、usage 通过');
  });

  it('does not publish superseded blocker claims', async () => {
    const notes = await text('docs/release-notes-rc1.md');
    for (const stale of [
      'Codex Direct real upstream smoke is blocked',
      'DeepSeek and multi-model platform real credentials were not present',
      'retains three existing Windows/invariant failures',
    ]) {
      expect(notes).not.toContain(stale);
    }
  });

  it('packages the CLIProxy provider, operator guide, license and third-party notices', async () => {
    const packager = await text('scripts/package-release.mjs');
    for (const required of [
      "integrations/cliproxyapi/dsh-provider",
      "integrations/cliproxyapi/README.md",
      "integrations/cliproxyapi/CLIProxyAPI-LICENSE",
      "THIRD_PARTY_NOTICES.md",
    ]) {
      expect(packager).toContain(required);
    }
    expect(packager).toContain('VISIOND_BIN');
    expect(packager).toContain('VISION_DESKTOP_BIN');
  });

  it('uses the project-generated icon rather than the donor placeholder', async () => {
    const notices = await text('THIRD_PARTY_NOTICES.md');
    expect(notices).toContain('scripts/generate-vision-icon.ps1');
    expect(notices).not.toContain('Replace it with Vision artwork before distribution');
  });

  it('keeps the real Direct smoke on the release-validated Codex model', async () => {
    const smoke = await text('scripts/real-codex-direct-smoke.mjs');
    expect(smoke).toContain("process.env.CODEX_MODEL ?? 'gpt-5.6-luna'");
    expect(smoke).not.toContain("process.env.CODEX_MODEL ?? 'gpt-5.3-codex'");
  });
});
