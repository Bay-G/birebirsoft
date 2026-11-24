import { isIP } from 'node:net';

const MAX_QUERY_LENGTH = 500;

/** "::ffff:1.2.3.4" gibi IPv4-eşlemeli IPv6 adreslerini "1.2.3.4" yapar; geçersizse null. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim();
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return isIP(ip) === 0 ? null : ip;
}

/**
 * İstemci IP'si.
 *  - trustProxy=false (varsayılan): yalnızca doğrudan bağlantı adresi. X-Forwarded-For YOK SAYILIR
 *    (istemci bu başlığı kendisi yazıp sahte IP gösterebilir).
 *  - trustProxy=true: servis güvenilir bir ters vekilin (nginx, yük dengeleyici) arkasındadır;
 *    X-Forwarded-For'un ilk adresi kullanılır, yoksa/geçersizse bağlantı adresine düşülür.
 */
export function extractClientIp(
  forwardedFor: string | null,
  socketAddress: string | null | undefined,
  trustProxy: boolean,
): string | null {
  if (trustProxy && forwardedFor) {
    const first = normalizeIp(forwardedFor.split(',')[0]);
    if (first) return first;
  }
  return normalizeIp(socketAddress);
}

const toNumber = (raw: string | null): number | null => {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** Sorgu metni (kısaltılmış) ve lat/lng değerleri. Geçersiz değerler (örn. lat=abc) için lat/lng null, queryString dolu kalır. */
export function extractQueryInfo(url: URL): { queryString: string | null; lat: number | null; lng: number | null } {
  const search = url.search.startsWith('?') ? url.search.slice(1) : url.search;
  return {
    queryString: search === '' ? null : search.slice(0, MAX_QUERY_LENGTH),
    lat: toNumber(url.searchParams.get('lat')),
    lng: toNumber(url.searchParams.get('lng')),
  };
}