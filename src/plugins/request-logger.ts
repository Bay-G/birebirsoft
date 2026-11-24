import { Elysia } from 'elysia';
import type { Logger } from '../core/logger.ts';
import type { RequestLogSink } from '../core/request-log.ts';
import { extractClientIp, extractQueryInfo } from './client-info.ts';
import { getApiKeyId, getErrorInfo, getRequestId } from './request-context.ts';
import { getSocketIp } from './socket-ip.ts';

const startTimes = new WeakMap<Request, number>();

/** Veritabanına yazılmayan yollar (probe'lar her 15 saniyede çağrıldığı için tabloyu gürültüyle doldurur). */
const isNoise = (path: string): boolean => path.startsWith('/health');

export interface RequestLoggerOptions {
  /** Servis güvenilir bir ters vekilin arkasındaysa true (X-Forwarded-For'a güvenilir). */
  trustProxy: boolean;
}

/**
 * Her istek için:
 *  1) stdout'a tek satırlık yapılandırılmış log (durum koduna göre info/warn/error),
 *  2) (etkinse) request_logs tablosuna kayıt — asenkron/toplu, istek süresini etkilemez.
 * IP, sorgu metni ve lat/lng hem stdout loguna hem tabloya yazılır.
 */
export const requestLogger = (
  logger: Logger,
  sink: RequestLogSink,
  options: RequestLoggerOptions = { trustProxy: false },
) =>
  new Elysia({ name: 'request-logger' })
    // onRequest seçenek (as) almaz; zaten her zaman global çalışır.
    .onRequest(({ request }) => {
      startTimes.set(request, performance.now());
    })
    .onAfterResponse({ as: 'global' }, ({ request, set, response, server }) => {
      const started = startTimes.get(request);
      const durationMs = started === undefined ? 0 : Math.round((performance.now() - started) * 100) / 100;
      const status =
        response instanceof Response ? response.status : typeof set.status === 'number' ? set.status : 200;
      const url = new URL(request.url);
      const path = url.pathname;
      const requestId = getRequestId(request);
      const error = getErrorInfo(request);

      try {
        const query = extractQueryInfo(url);
        const clientIp = extractClientIp(
          request.headers.get('x-forwarded-for'),
          // 1) Bun fetch kancasında iliştirilen adres (güvenilir), 2) Elysia bağlamındaki server (yedek)
          getSocketIp(request) ?? server?.requestIP(request)?.address,
          options.trustProxy,
        );

        const fields = {
          requestId,
          method: request.method,
          path,
          status,
          durationMs,
          errorCode: error?.code,
          clientIp,
          queryString: query.queryString,
        };
        if (status >= 500) logger.error(fields, 'request');
        else if (status >= 400) logger.warn(fields, 'request');
        else logger.info(fields, 'request');

        if (isNoise(path)) return;
        sink.record({
          createdAt: new Date().toISOString(),
          requestId,
          method: request.method,
          path,
          statusCode: status,
          durationMs,
          errorCode: error?.code ?? null,
          errorDetail: error?.detail ?? null,
          apiKeyId: getApiKeyId(request) ?? null,
          clientIp,
          queryString: query.queryString,
          lat: query.lat,
          lng: query.lng,
        });
      } catch (err) {
        // Loglama hatası asla isteği etkilememeli.
        logger.error({ err }, 'İstek logu işlenemedi');
      }
    });