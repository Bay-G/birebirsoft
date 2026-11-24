import { gzipSync } from 'node:zlib';

/** Bayt bütçeli, FIFO tahliyeli basit bellek içi cache (sıkıştırılmış response'lar için). */
export class ByteBudgetCache {
  private map = new Map<string, Uint8Array>();
  private bytes = 0;
  constructor(private readonly maxBytes: number) {}

  get(key: string): Uint8Array | undefined {
    return this.map.get(key);
  }

  set(key: string, value: Uint8Array): void {
    if (this.maxBytes === 0 || value.byteLength > this.maxBytes / 4) return;
    const prev = this.map.get(key);
    if (prev) this.bytes -= prev.byteLength;
    this.map.set(key, value);
    this.bytes += value.byteLength;
    for (const [k, v] of this.map) {
      if (this.bytes <= this.maxBytes) break;
      this.map.delete(k);
      this.bytes -= v.byteLength;
    }
  }
}

export interface RawJsonOptions {
  /** İçerik sürümü (dataset version). Veri değişmedikçe ETag sabit kalır. */
  version: string;
  cacheMaxAgeSeconds: number;
  cache: ByteBudgetCache;
  contentType?: string;
}

const MIN_GZIP_BYTES = 1024;

/**
 * Hazır JSON string'i yeniden serileştirmeden yazar; ETag/304 ve gzip (cache'li) uygular.
 * Veri değişmez olduğu için aynı URL + aynı dataset sürümü = aynı gövde.
 */
export function rawJsonResponse(request: Request, body: string, opts: RawJsonOptions): Response {
  const etag = `W/"${opts.version}"`;
  const headers: Record<string, string> = {
    'Content-Type': opts.contentType ?? 'application/geo+json; charset=utf-8',
    ETag: etag,
    'Cache-Control': `public, max-age=${opts.cacheMaxAgeSeconds}`,
    Vary: 'Accept-Encoding',
  };

  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch.split(',').some((t) => t.trim() === etag || t.trim() === '*')) {
    return new Response(null, { status: 304, headers });
  }

  const acceptsGzip = /\bgzip\b/.test(request.headers.get('accept-encoding') ?? '');
  if (acceptsGzip && body.length >= MIN_GZIP_BYTES) {
    const key = `${opts.version}:${request.url}`;
    let zipped = opts.cache.get(key);
    if (!zipped) {
      zipped = gzipSync(body);
      opts.cache.set(key, zipped);
    }
    headers['Content-Encoding'] = 'gzip';
    return new Response(zipped as unknown as BodyInit, { status: 200, headers });
  }
  return new Response(body, { status: 200, headers });
}
