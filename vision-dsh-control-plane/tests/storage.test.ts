import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequest, redact } from '../apps/desktop/src/core.js';
import { VisionStore } from '../apps/desktop/src/storage.js';

const stores: VisionStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.db.close(); });

function makeStore(): VisionStore { const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vision-store-')), 'vision.db'); const store = new VisionStore(file); store.seed(); stores.push(store); return store; }

describe('Vision storage invariants', () => {
  it('uses migrations and keeps observations append-only', () => {
    const store = makeStore();
    expect((store.db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
    const request = createRequest({ requestedModel: 'vision-mock-1', normalizedModel: 'vision-mock-1', billingModel: 'vision-mock-1' });
    store.addObservation({ observationId: 'obs-a', logicalRequestId: request.logicalRequestId, source: 'manual', confidence: 'low', capturedAt: request.receivedAt, rawSchemaVersion: 'test-v1', metrics: {}, metadata: { api_key: 'sk-secret' }, payloadHash: 'hash-a' });
    store.addObservation({ observationId: 'obs-b', logicalRequestId: request.logicalRequestId, source: 'provider_api', confidence: 'high', capturedAt: request.receivedAt, rawSchemaVersion: 'test-v1', metrics: {}, metadata: {}, payloadHash: 'hash-b' });
    expect(Number((store.db.prepare('SELECT COUNT(*) count FROM request_observations').get() as { count: number }).count)).toBe(2);
    expect(JSON.stringify(store.db.prepare('SELECT metadata FROM request_observations WHERE observation_id=?').get('obs-a'))).not.toContain('sk-secret');
  });
  it('prevents ordinary updates after finalization', () => {
    const store = makeStore();
    const request = createRequest({ requestedModel: 'vision-mock-1', normalizedModel: 'vision-mock-1', billingModel: 'vision-mock-1' });
    request.status = 'success'; request.finalizedAt = new Date().toISOString();
    store.saveRequest(request);
    request.status = 'error'; store.saveRequest(request);
    expect(store.listRequests(1)[0]?.status).toBe('success');
    expect(() => store.db.prepare("UPDATE requests SET status='error' WHERE id=?").run(request.id)).toThrow(/immutable/);
  });
  it('supports local Agent/Preset CRUD and privacy retention guard', () => {
    const store = makeStore();
    store.saveAgent({ id: 'local', name: 'Local', type: 'custom' });
    store.savePreset({ id: 'local-preset', name: 'Local', providerId: 'mock', requestedModel: 'vision-mock-1' });
    expect(store.listAgents().some((x) => x.id === 'local')).toBe(true);
    expect(store.listPresets().some((x) => x.id === 'local-preset')).toBe(true);
    expect(() => store.setPrivacyConfig('debug', null)).toThrow(/retention/);
    store.setPrivacyConfig('debug', '24h');
    expect(store.getPrivacyConfig()).toEqual({ mode: 'debug', retention: '24h' });
  });
  it('redacts query credentials as well as headers', () => {
    expect(redact('https://provider.test/?access_token=secret&x=1')).toBe('https://provider.test/?access_token=[REDACTED]&x=1');
  });
});
