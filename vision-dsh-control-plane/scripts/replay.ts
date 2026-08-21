import { replayFixture } from '../apps/desktop/src/replay.js';
import { VisionStore } from '../apps/desktop/src/storage.js';
const fixture = process.argv[2] ?? 'fixtures/responses/simple';
const store = new VisionStore();
const result = await replayFixture(fixture, store);
console.log(JSON.stringify(result, null, 2));
process.exit(result.passed ? 0 : 1);
