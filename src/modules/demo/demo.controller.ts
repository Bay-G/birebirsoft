import { readFileSync } from 'node:fs';
import { Elysia } from 'elysia';

/**
 * Geliştirme amaçlı harita sayfası (Leaflet). API key GEREKTİRMEZ (sayfa sadece statik HTML);
 * sayfa, key'i kullanıcıdan alıp /v1 çağrılarına kendisi ekler. Aynı origin'den çalıştığı için CORS gerekmez.
 * DEMO_ENABLED=false ile kapatılır (production'da varsayılan kapalı).
 */
export const demoController = () => {
  const html = readFileSync(new URL('./demo.html', import.meta.url), 'utf8');
  return new Elysia({ name: 'demo' }).get(
    '/demo',
    () => new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    { detail: { hide: true } },
  );
};
