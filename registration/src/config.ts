import path from 'node:path';

type AppConfig = {
  host: string;
  port: number;
  appBaseUrl: string;
  publicSiteBaseUrl: string;
  sqlitePath: string;
  allowedOrigins: string[];
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/u, '');
}

function parsePort(value: string | undefined, fallback: number) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function parseOrigins(value: string | undefined, fallback: string) {
  return (value ?? fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(trimTrailingSlash);
}

export function loadConfig(): AppConfig {
  const host = process.env.HOST?.trim() || '0.0.0.0';
  const port = parsePort(process.env.PORT, 3001);
  const appBaseUrl = trimTrailingSlash(process.env.APP_BASE_URL?.trim() || `http://localhost:${port}`);
  const publicSiteBaseUrl = trimTrailingSlash(process.env.PUBLIC_SITE_BASE_URL?.trim() || 'http://localhost:4321');
  const sqlitePath = path.resolve(process.cwd(), process.env.SQLITE_PATH?.trim() || './data/registration.sqlite');
  const allowedOrigins = parseOrigins(process.env.CORS_ORIGINS, publicSiteBaseUrl);

  return {
    host,
    port,
    appBaseUrl,
    publicSiteBaseUrl,
    sqlitePath,
    allowedOrigins,
  };
}
