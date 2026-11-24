import { swagger } from '@elysiajs/swagger';
import { Elysia } from 'elysia';
import type { AppConfig } from './config/env.ts';
import type { Logger } from './core/logger.ts';
import { NoopRequestLogSink, type RequestLogSink } from './core/request-log.ts';
import type { GeoRepository } from './data/geo-repository.ts';
import { demoController } from './modules/demo/demo.controller.ts';
import { districtController } from './modules/districts/district.controller.ts';
import { DistrictService } from './modules/districts/district.service.ts';
import { geoJsonController } from './modules/geojson/geojson.controller.ts';
import { GeoJsonService } from './modules/geojson/geojson.service.ts';
import { healthController } from './modules/health/health.controller.ts';
import { lookupController } from './modules/lookup/lookup.controller.ts';
import { LookupService } from './modules/lookup/lookup.service.ts';
import { neighborhoodController } from './modules/neighborhoods/neighborhood.controller.ts';
import { NeighborhoodService } from './modules/neighborhoods/neighborhood.service.ts';
import { provinceController } from './modules/provinces/province.controller.ts';
import { ProvinceService } from './modules/provinces/province.service.ts';
import type { GeoJsonResponder } from './modules/shared/types.ts';
import { apiKeyAuth } from './plugins/api-key-auth.ts';
import { errorHandler } from './plugins/error-handler.ts';
import { ByteBudgetCache, rawJsonResponse } from './plugins/geojson-response.ts';
import { requestLogger } from './plugins/request-logger.ts';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  repo: GeoRepository;
  /** init() tamamlandı mı? (readiness) */
  isReady: () => boolean;
  /** İstek loglarının yazılacağı yer (verilmezse yalnızca stdout logu). */
  requestLog?: RequestLogSink;
}

/**
 * Uygulamanın kompozisyon kökü: bağımlılıklar burada elle bağlanır.
 * PostGIS'e geçişte yalnızca `repo` implementasyonu değişir.
 */
export function createApp({ config, logger, repo, isReady, requestLog = new NoopRequestLogSink() }: AppDeps) {
  const provinces = new ProvinceService(repo);
  const districts = new DistrictService(repo);
  const neighborhoods = new NeighborhoodService(repo);
  const geo = new GeoJsonService(repo);
  const lookup = new LookupService(repo);

  const gzipCache = new ByteBudgetCache(config.gzipCacheBytes);
  const respond: GeoJsonResponder = (request, body) =>
    rawJsonResponse(request, body, {
      version: repo.stats().version,
      cacheMaxAgeSeconds: config.cacheMaxAgeSeconds,
      cache: gzipCache,
    });

  const app = new Elysia({ name: 'address-services' })
    .use(requestLogger(logger, requestLog, { trustProxy: config.trustProxy }))
    .use(errorHandler(logger))
    // --- Public bölge: auth'tan ÖNCE kaydedilir ---
    .use(healthController(isReady));

  if (config.demo.enabled) app.use(demoController());

  if (config.swagger.enabled) {
    app.use(
      swagger({
        path: config.swagger.path,
        documentation: {
          info: {
            title: 'Address Services API',
            version: '1.0.0',
            description:
              'Türkiye il / ilçe / mahalle verisi (isim, nüfus, sınır geometrisi). ' +
              'Tüm `/v1` endpoint\'leri API anahtarı gerektirir. Geometri endpoint\'leri GeoJSON döner (`application/geo+json`).',
          },
          tags: [
            { name: 'Provinces', description: 'İller' },
            { name: 'Districts', description: 'İlçeler' },
            { name: 'Neighborhoods', description: 'Mahalleler' },
            { name: 'GeoJSON', description: 'Toplu FeatureCollection çıktıları (harita istemcileri)' },
            { name: 'Lookup', description: 'Arama, koordinattan bölge bulma, veri seti bilgisi' },
            { name: 'Health', description: 'Probe\'lar (public)' },
          ],
          components: {
            securitySchemes: {
              ApiKeyAuth: { type: 'apiKey', in: 'header', name: config.apiKeyHeader },
            },
          },
          security: [{ ApiKeyAuth: [] }],
        },
        swaggerOptions: {
          persistAuthorization: true,
          // Büyük (yüzlerce KB) GeoJSON yanıtlarında renklendirme tarayıcı sekmesini dondurur.
          syntaxHighlight: false,
        },
      }),
    );
  }

  return app
    // --- Korumalı bölge: bu satırdan sonraki tüm route'lar API key ister ---
    .use(apiKeyAuth({ header: config.apiKeyHeader, keys: config.apiKeys }))
    .use(provinceController(provinces, geo, respond))
    .use(districtController(districts, geo, respond))
    .use(neighborhoodController(neighborhoods, geo, respond))
    .use(geoJsonController(geo, respond))
    .use(lookupController(lookup));
}

export type App = ReturnType<typeof createApp>;
