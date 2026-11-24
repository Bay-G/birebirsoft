import { createHash, timingSafeEqual } from 'node:crypto';
import { Elysia } from 'elysia';
import { UnauthorizedError } from '../core/errors.ts';
import { setApiKeyId } from './request-context.ts';

const digest = (s: string): Buffer => createHash('sha256').update(s).digest();

/**
 * API key doğrulaması. Plugin'in `.use()` edildiği noktadan SONRA tanımlanan tüm route'lara uygulanır
 * (Elysia hook'ları kayıt sırasına duyarlıdır); bu yüzden /health ve /swagger bundan ÖNCE kaydedilir.
 *
 * Anahtarlar sabit uzunlukta SHA-256 özetleri üzerinden, zamanlama saldırısına dayanıklı karşılaştırılır.
 * Doğru anahtarın özetinin ilk 8 karakteri istek loguna "api_key" olarak eklenir (anahtarın kendisi asla loglanmaz).
 */
export const apiKeyAuth = (opts: { header: string; keys: string[] }) => {
  const digests = opts.keys.map(digest);
  const keyIds = digests.map((d) => d.toString('hex').slice(0, 8));
  return new Elysia({ name: 'api-key-auth' }).onBeforeHandle({ as: 'global' }, ({ request }) => {
    const provided = request.headers.get(opts.header);
    if (!provided) throw new UnauthorizedError(`"${opts.header}" header'ı eksik`);
    const d = digest(provided);
    let matched = -1;
    digests.forEach((known, i) => {
      if (timingSafeEqual(known, d)) matched = i;
    });
    if (matched < 0) throw new UnauthorizedError();
    const id = keyIds[matched];
    if (id) setApiKeyId(request, id);
  });
};
