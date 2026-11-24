import { Elysia, type ValidationError } from 'elysia';
import { AppError } from '../core/errors.ts';
import type { Logger } from '../core/logger.ts';
import { getRequestId, setErrorInfo } from './request-context.ts';

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
  requestId: string;
}

const describe = (err: unknown): string => {
  if (err instanceof Error) return `${err.name}: ${err.message}\n${(err.stack ?? '').split('\n').slice(0, 6).join('\n')}`;
  return String(err);
};

/** Tüm hataların tek çıkış noktası: tutarlı JSON gövdesi + doğru HTTP status. */
export const errorHandler = (logger: Logger) =>
  new Elysia({ name: 'error-handler' }).onError({ as: 'global' }, ({ code, error, set, request }): ErrorBody => {
    const requestId = getRequestId(request);
    // internalDetail: yalnızca log/veritabanına gider, istemciye ASLA gönderilmez.
    const body = (
      status: number,
      errCode: string,
      message: string,
      details?: unknown,
      internalDetail: string | null = null,
    ): ErrorBody => {
      set.status = status;
            // 5xx'te iç ayrıntı, 4xx'te istemciye de giden mesaj (ve varsa doğrulama ayrıntıları) saklanır.
      const stored = internalDetail ?? (details === undefined ? message : `${message} ${JSON.stringify(details)}`);
      setErrorInfo(request, { code: errCode, detail: stored });
      return { error: { code: errCode, message, ...(details === undefined ? {} : { details }) }, requestId };
    };

    if (error instanceof AppError) {
      if (error.status >= 500) logger.error({ requestId, err: error }, error.message);
      return body(error.status, error.code, error.message, error.details, error.status >= 500 ? describe(error) : null);
    }

    switch (code) {
      case 'VALIDATION': {
        const v = error as ValidationError;
        const details = v.all.map((e) => ({
          in: e.path ? e.path.replace(/^\//, '') : 'request',
          message: e.summary ?? e.message,
        }));
        return body(400, 'VALIDATION_ERROR', 'İstek parametreleri geçersiz', details);
      }
      case 'NOT_FOUND':
        return body(404, 'ROUTE_NOT_FOUND', 'Endpoint bulunamadı');
      case 'PARSE':
        return body(400, 'BAD_REQUEST', 'İstek gövdesi okunamadı');
      default:
        // İç hata detayını istemciye sızdırmıyoruz; yalnızca log'a ve veritabanına yazıyoruz.
        logger.error({ requestId, err: error, code }, 'Beklenmeyen hata');
        return body(500, 'INTERNAL_ERROR', 'Beklenmeyen bir hata oluştu', undefined, describe(error));
    }
  });
