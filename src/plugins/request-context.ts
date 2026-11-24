import { randomUUID } from 'node:crypto';

// Aynı Request nesnesi tüm lifecycle hook'larında paylaşıldığı için, istek başına bilgiler
// WeakMap'lerde tutulur (istek bitince otomatik temizlenir).
const ids = new WeakMap<Request, string>();

export function getRequestId(request: Request): string {
  let id = ids.get(request);
  if (!id) {
    const incoming = request.headers.get('x-request-id');
    id = incoming && /^[\w.-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    ids.set(request, id);
  }
  return id;
}

export interface ErrorInfo {
  code: string;
  /** Yalnızca iç hatalar (5xx) için; istemciye gönderilmez. */
  detail: string | null;
}

const errors = new WeakMap<Request, ErrorInfo>();
export const setErrorInfo = (request: Request, info: ErrorInfo): void => void errors.set(request, info);
export const getErrorInfo = (request: Request): ErrorInfo | undefined => errors.get(request);

const keyIds = new WeakMap<Request, string>();
/** Doğrulanmış API anahtarının kısa, geri döndürülemez parmak izi (anahtarın kendisi değil). */
export const setApiKeyId = (request: Request, id: string): void => void keyIds.set(request, id);
export const getApiKeyId = (request: Request): string | undefined => keyIds.get(request);
