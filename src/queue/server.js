import { createServer } from 'node:http';
import { createDatabase } from './database.js';
import { createQueueService } from './queueService.js';
import { createApp } from './app.js';
import { attachSockets } from './queueSocket.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const prisma = createDatabase(process.env.DATABASE_URL);
const service = createQueueService(prisma);
const origin = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';
let realtime;
const events = {
  publish: (...args) => realtime.publish(...args),
  queueChanged: (...args) => realtime.queueChanged(...args),
};
const app = createApp({ service, staffKey: process.env.STAFF_API_KEY, origin, events });
const server = createServer(app);
realtime = attachSockets(server, service, origin);
await prisma.$connect();
server.listen(Number(process.env.PORT ?? 3001), () => console.log('SmartQueue backend is ready.'));

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 10_000).unref();
  await new Promise((resolve) => realtime.io.close(resolve));
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
  clearTimeout(timeout);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
