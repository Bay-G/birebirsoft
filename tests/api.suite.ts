import { beforeAll, describe, expect, it } from 'bun:test';
import { gunzipSync } from 'node:zlib';
import { createApp, type App } from '../src/app.ts';
import { loadConfig } from '../src/config/env.ts';
import type { GeoRepository } from '../src/data/geo-repository.ts';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const KEY = 'test-key-0123456789-abcdefgh';

/**
 * Aynı API testlerini herhangi bir GeoRepository implementasyonuna karşı çalıştırır.
 * Böylece bellek içi (GeoJSON) ve PostGIS sürümlerinin aynı davrandığı kanıtlanır.
 */
export function defineApiTests(label: string, makeRepo: () => GeoRepository): void {
  describe(label, () => {
    let app: App;

    const call = (path: string, init: RequestInit & { key?: string | null } = {}) => {
      const { key = KEY, headers, ...rest } = init;
      return app.handle(
        new Request(`http://localhost${path}`, {
          ...rest,
          headers: { ...(key ? { 'x-api-key': key } : {}), ...(headers as Record<string, string>) },
        }),
      );
    };

    beforeAll(async () => {
      const config = loadConfig({ NODE_ENV: 'test', API_KEYS: KEY, LOG_LEVEL: 'silent' });
      const repo = makeRepo();
      await repo.init();
      app = createApp({ config, logger: silent, repo, isReady: () => true });
    });

    describe('auth', () => {
      it('health herkese açık', async () => {
        expect((await call('/health', { key: null })).status).toBe(200);
      });
      it('anahtarsız /v1 isteği 401', async () => {
        const res = await call('/v1/provinces', { key: null });
        expect(res.status).toBe(401);
        expect((await res.json()).error.code).toBe('UNAUTHORIZED');
      });
      it('yanlış anahtar 401', async () => {
        expect((await call('/v1/provinces', { key: 'wrong' })).status).toBe(401);
      });
    });

    describe('okuma endpointleri', () => {
      it('il listesi', async () => {
        const res = await call('/v1/provinces');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body[0].name).toBe('Adana');
      });
      it('ilçe listesi ve mahalle sayfalaması', async () => {
        const res = await call('/v1/districts/1329/neighborhoods?limit=5&offset=0');
        const body = await res.json();
        expect(body.items).toHaveLength(5);
        expect(body.total).toBe(48);
      });
      it('olmayan il 404', async () => {
        const res = await call('/v1/provinces/999');
        expect(res.status).toBe(404);
        expect((await res.json()).error.code).toBe('NOT_FOUND');
      });
      it('geçersiz id 400', async () => {
        const res = await call('/v1/provinces/abc');
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
      });
      it('bilinmeyen route 404', async () => {
        expect((await call('/v1/nope')).status).toBe(404);
      });
    });

    describe('geometri', () => {
      it('Feature döner ve ETag ile 304 verir', async () => {
        const res = await call('/v1/neighborhoods/10301/geometry');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/geo+json');
        const feature = await res.json();
        expect(feature.type).toBe('Feature');
        expect(feature.geometry.type).toBe('Polygon');
        const etag = res.headers.get('etag')!;
        const again = await call('/v1/neighborhoods/10301/geometry', { headers: { 'if-none-match': etag } });
        expect(again.status).toBe(304);
      });
      it('gzip destekler', async () => {
        const res = await call('/v1/geojson/provinces', { headers: { 'accept-encoding': 'gzip' } });
        expect(res.headers.get('content-encoding')).toBe('gzip');
        const json = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'));
        expect(json.type).toBe('FeatureCollection');
      });
      it('mahalle collection için il/ilçe filtresi zorunlu', async () => {
        expect((await call('/v1/geojson/neighborhoods')).status).toBe(400);
        expect((await call('/v1/geojson/neighborhoods?districtId=1329')).status).toBe(200);
      });
    });

    describe('arama ve locate', () => {
      it('Türkçe karakter duyarsız arama', async () => {
        const hits = await (await call('/v1/search?q=cukurova')).json();
        expect(hits[0].name).toBe('Çukurova');
      });
      it('koordinattan mahalle bulur', async () => {
        const n = await (await call('/v1/neighborhoods/10301')).json();
        const res = await call(`/v1/locate?lat=${n.centroid.lat}&lng=${n.centroid.lng}`);
        expect(res.status).toBe(200);
        expect((await res.json()).neighborhood.id).toBe(10301);
      });
      it('kapsam dışı nokta 404', async () => {
        expect((await call('/v1/locate?lat=41&lng=29')).status).toBe(404);
      });
    });
  });
}
