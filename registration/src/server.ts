import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { registerPublicApi } from './api/public';
import { syncCatalog } from './services/catalog';

const config = loadConfig();
const db = createDatabase(config.sqlitePath);

runMigrations(db);
syncCatalog(db);

const app = Fastify({
  logger: true,
  trustProxy: true,
  bodyLimit: 64 * 1024,
});

await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalized = origin.replace(/\/+$/u, '');
    const allowed = config.allowedOrigins.includes(normalized);
    callback(null, allowed);
  },
});

await app.register(rateLimit, {
  max: 120,
  timeWindow: '1 minute',
});

app.get('/api/v1/health', async () => {
  return {
    ok: true,
    service: 'registration',
    appBaseUrl: config.appBaseUrl,
  };
});

await registerPublicApi(app, db);

await app.listen({
  host: config.host,
  port: config.port,
});
