import { startMockProvider } from './mock.js';
import { startGateway } from './gateway.js';

const mock = startMockProvider(Number(process.env.VISION_MOCK_PORT ?? 8790));
const gateway = startGateway({ port: Number(process.env.VISION_GATEWAY_PORT ?? 8787) });
console.log('Vision Gateway listening on http://127.0.0.1:8787');
console.log('Vision Mock Provider listening on http://127.0.0.1:8790');
const close = () => { gateway.close(); mock.close(); };
process.on('SIGINT', close); process.on('SIGTERM', close);
