import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMockProvider } from '../apps/desktop/src/mock.js';
import { startGateway } from '../apps/desktop/src/gateway.js';
import { replayFixture } from '../apps/desktop/src/replay.js';
import { VisionStore } from '../apps/desktop/src/storage.js';

const store = new VisionStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vision-replay-')), 'replay.db'));
const mock = startMockProvider(18891);
const gateway = startGateway({ port: 18888, upstream: 'http://127.0.0.1:18891', store });
afterAll(() => { gateway.close(); mock.close(); store.db.close(); });

describe('golden fixture replay', () => {
  it.each(['simple', 'streaming', 'tool-call', 'reasoning', 'cache', 'missing-usage', 'inconsistent-usage'])('replays responses/%s', async (scenario) => {
    const result = await replayFixture(`fixtures/responses/${scenario}`, store, 'http://127.0.0.1:18888');
    expect(result.passed, JSON.stringify(result)).toBe(true);
  });
  it.each(['429', '500', 'timeout', 'invalid-json'])('replays upstream failure %s', async (scenario) => {
    const result = await replayFixture(`fixtures/responses/${scenario}`, store, 'http://127.0.0.1:18888');
    expect(result.passed, JSON.stringify(result)).toBe(true);
  });
  it('records an interrupted stream as aborted', async () => {
    const result = await replayFixture('fixtures/responses/stream-interrupted', store, 'http://127.0.0.1:18888');
    expect(result.actual.status).toBe('aborted');
    expect(result.passed, JSON.stringify(result)).toBe(true);
  });
});
