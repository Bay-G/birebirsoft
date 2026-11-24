import { resolve } from 'node:path';
import { ConfigError } from '../core/errors.ts';

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  logLevel: string;
  apiKeys: string[];
  apiKeyHeader: string;
  data: { dir: string; files: { province: string; district: string; neighborhood: string } };
  cacheMaxAgeSeconds: number;
  gzipCacheBytes: number;
  swagger: { enabled: boolean; path: string };
  demo: { enabled: boolean };
  /** Veri kaynağı: bellek içi GeoJSON ya da PostgreSQL/PostGIS */
  repository: { driver: 'geojson' } | { driver: 'postgis'; databaseUrl: string; poolMax: number };
  /** İstek loglarının veritabanındaki request_logs tablosuna yazılması */
  requestLog: { enabled: false } | { enabled: true; databaseUrl: string; retentionDays: number };
  trustProxy: boolean; 
}

type Env = Record<string, string | undefined>;

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/** Env değişkenlerini okur, doğrular ve tipli bir config döner. Tüm hataları tek seferde bildirir. */
export function loadConfig(env: Env = process.env): AppConfig {
  const problems: string[] = [];
  const str = (key: string, def?: string): string => {
    const v = env[key]?.trim();
    if (v) return v;
    if (def !== undefined) return def;
    problems.push(`${key} zorunlu`);
    return '';
  };
  const int = (key: string, def: number, min: number, max: number): number => {
    const raw = env[key]?.trim();
    if (!raw) return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      problems.push(`${key} ${min}-${max} arasında tam sayı olmalı (gelen: "${raw}")`);
      return def;
    }
    return n;
  };
  const bool = (key: string, def: boolean): boolean => {
    const raw = env[key]?.trim().toLowerCase();
    if (!raw) return def;
    if (['true', '1', 'yes'].includes(raw)) return true;
    if (['false', '0', 'no'].includes(raw)) return false;
    problems.push(`${key} true/false olmalı (gelen: "${raw}")`);
    return def;
  };

  const nodeEnv = str('NODE_ENV', 'development');
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    problems.push(`NODE_ENV development|production|test olmalı (gelen: "${nodeEnv}")`);
  }
  const logLevel = str('LOG_LEVEL', 'info');
  if (!LOG_LEVELS.includes(logLevel)) problems.push(`LOG_LEVEL geçersiz: "${logLevel}"`);

  const apiKeys = (env['API_KEYS'] ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (apiKeys.length === 0) problems.push('API_KEYS zorunlu (virgülle ayrılmış en az bir anahtar)');
  if (nodeEnv === 'production' && apiKeys.some((k) => k.length < 24)) {
    problems.push('Production ortamında API anahtarları en az 24 karakter olmalı');
  }

  const driver = str('REPOSITORY_DRIVER', 'geojson');
  if (!['geojson', 'postgis'].includes(driver)) {
    problems.push(`REPOSITORY_DRIVER geojson|postgis olmalı (gelen: "${driver}")`);
  }
  const databaseUrl = env['DATABASE_URL']?.trim();
  if (driver === 'postgis' && !databaseUrl) problems.push('REPOSITORY_DRIVER=postgis iken DATABASE_URL zorunlu');
  const poolMax = int('DB_POOL_MAX', 10, 1, 200);

  const requestLogEnabled = bool('REQUEST_LOG_DB', false);
  if (requestLogEnabled && !databaseUrl) problems.push('REQUEST_LOG_DB=true iken DATABASE_URL zorunlu');
  const retentionDays = int('LOG_RETENTION_DAYS', 30, 1, 3650);

  const dataDir = resolve(str('DATA_DIR', './data'));
  const swaggerPath = str('SWAGGER_PATH', '/swagger');
  if (!swaggerPath.startsWith('/')) problems.push('SWAGGER_PATH "/" ile başlamalı');

  const config: AppConfig = {
    env: nodeEnv as AppConfig['env'],
    host: str('HOST', '0.0.0.0'),
    port: int('PORT', 3000, 1, 65535),
    logLevel,
    apiKeys,
    apiKeyHeader: str('API_KEY_HEADER', 'x-api-key').toLowerCase(),
    data: {
      dir: dataDir,
      files: {
        province: str('PROVINCE_FILE', 'il.geojson'),
        district: str('DISTRICT_FILE', 'ilce.geojson'),
        neighborhood: str('NEIGHBORHOOD_FILE', 'mahalle.geojson'),
      },
    },
    cacheMaxAgeSeconds: int('CACHE_MAX_AGE_SECONDS', 86_400, 0, 31_536_000),
    gzipCacheBytes: int('GZIP_CACHE_MB', 64, 0, 4096) * 1024 * 1024,
    swagger: { enabled: bool('SWAGGER_ENABLED', true), path: swaggerPath },
    demo: { enabled: bool('DEMO_ENABLED', nodeEnv !== 'production') },
    repository:
      driver === 'postgis' && databaseUrl ? { driver: 'postgis', databaseUrl, poolMax } : { driver: 'geojson' },
      trustProxy: bool('TRUST_PROXY', false),
    requestLog:
      requestLogEnabled && databaseUrl ? { enabled: true, databaseUrl, retentionDays } : { enabled: false },
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
