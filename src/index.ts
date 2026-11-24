import { createApp } from './app.ts';
import { loadConfig } from './config/env.ts';
import { ConfigError } from './core/errors.ts';
import { createLogger } from './core/logger.ts';
import { BatchedRequestLogSink, NoopRequestLogSink, type RequestLogSink } from './core/request-log.ts';
import type { GeoRepository } from './data/geo-repository.ts';
import { GeoJsonRepository } from './data/geojson/geojson-repository.ts';
import { PostgisRepository } from './data/postgis/postgis-repository.ts';
import { PostgresRequestLogStore } from './data/postgis/request-log-store.ts';
import { setSocketIp } from './plugins/socket-ip.ts';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const logger = createLogger(config.logLevel);

  // Veri kaynağı env ile seçilir; service/controller katmanı hangisinin kullanıldığını bilmez.
  const repo: GeoRepository =
    config.repository.driver === 'postgis'
      ? new PostgisRepository({ url: config.repository.databaseUrl, poolMax: config.repository.poolMax }, logger)
      : new GeoJsonRepository(config.data, logger);
  logger.info({ driver: config.repository.driver }, 'Veri kaynağı seçildi');

  // Veri (veya veritabanı bağlantısı/şeması), HTTP trafiği kabul edilmeden ÖNCE bir kez doğrulanır/yüklenir.
  await repo.init();
  const mem = process.memoryUsage();
  logger.info({ rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576) }, 'Bellek durumu (yükleme sonrası)');

  // İstek logları: etkinse request_logs tablosuna toplu/asenkron yazılır. Tablo kurulamazsa servis açılmaz (fail-fast).
  let requestLog: RequestLogSink = new NoopRequestLogSink();
  let logStore: PostgresRequestLogStore | undefined;
  let purgeTimer: ReturnType<typeof setInterval> | undefined;
  if (config.requestLog.enabled) {
    const store = new PostgresRequestLogStore(config.requestLog.databaseUrl);
    await store.init();
    const sink = new BatchedRequestLogSink((batch) => store.insertBatch(batch), logger);
    sink.start();
    requestLog = sink;
    logStore = store;

    const days = config.requestLog.retentionDays;
    const purge = (): void => {
      store
        .purgeOlderThan(days)
        .then((deleted) => {
          if (deleted > 0) logger.info({ deleted, retentionDays: days }, 'Saklama süresini aşan istek logları silindi');
        })
        .catch((err: unknown) => logger.error({ err }, 'İstek logu temizliği başarısız'));
    };
    purge();
    purgeTimer = setInterval(purge, SIX_HOURS_MS);
    purgeTimer.unref?.();
    logger.info({ retentionDays: days }, 'İstek logları veritabanına yazılacak (request_logs)');
  }

    const app = createApp({ config, logger, repo, isReady: () => true, requestLog });

  // Elysia'nın listen()'i yerine Bun.serve kullanıyoruz: IP adresi, belgelenmiş standart yol olan
  // fetch(request, server) kancasında okunur ve isteğe iliştirilir (Elysia hook'larındaki `server`
  // her istekte dolu gelmediği için).
  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch(request, srv) {
      const address = srv.requestIP(request)?.address;
      if (address) setSocketIp(request, address);
      return app.handle(request);
    },
  });
  logger.info(
    { host: config.host, port: config.port, swagger: config.swagger.enabled ? config.swagger.path : false },
    'address-services dinlemede',
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Kapatılıyor');
    await server.stop();
    if (purgeTimer) clearInterval(purgeTimer);
    await requestLog.close(); // kuyrukta bekleyen loglar yazılır
    await logStore?.close();
    await repo.close?.();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('Başlatma hatası:', err);
  process.exit(1);
});
