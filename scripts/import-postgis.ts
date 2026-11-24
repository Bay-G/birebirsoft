/**
 * GeoJSON dosyalarını PostgreSQL/PostGIS'e aktarır.
 *
 * Kullanım:   bun scripts/import-postgis.ts [--reset | --if-empty]
 * Gerekli:    DATABASE_URL (postgres://kullanici:sifre@host:port/db)
 * İsteğe bağlı: DATA_DIR, PROVINCE_FILE, DISTRICT_FILE, NEIGHBORHOOD_FILE (servisle aynı değişkenler)
 *
 * Tablolar doluysa varsayılan olarak HATA verir (yinelenen veri/sessiz üzerine yazma olmasın diye):
 *   --reset     : önce tüm tabloları boşaltır, sonra yükler
 *   --if-empty  : veritabanı doluysa hiçbir şey yapmadan başarıyla çıkar (docker compose importer bunu kullanır)
 * Tüm içe aktarma TEK transaction'dır: hata olursa hiçbir şey yazılmaz.
 */
import { SQL } from 'bun';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeBBox, computeCentroid } from '../src/data/geojson/geometry.ts';
import { loadFeatureCollection, validators } from '../src/data/geojson/loader.ts';
import { discoverSources } from '../src/data/geojson/sources.ts';
import { normalizeTr } from '../src/data/geojson/text.ts';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL zorunlu (örn. postgres://address:sifre@localhost:5433/address)');
  process.exit(1);
}
const reset = process.argv.includes('--reset');
const ifEmpty = process.argv.includes('--if-empty');
const dir = resolve(process.env['DATA_DIR'] ?? './data');
const files = {
  province: process.env['PROVINCE_FILE'] ?? 'il.geojson',
  district: process.env['DISTRICT_FILE'] ?? 'ilce.geojson',
  neighborhood: process.env['NEIGHBORHOOD_FILE'] ?? 'mahalle.geojson',
};

const sql = new SQL({ url, max: 2 });

async function main(): Promise<void> {
  const started = performance.now();

  console.log('Şema uygulanıyor (db/schema.sql)...');
  await sql.unsafe(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));

  if (reset) {
    console.log('--reset: mevcut veriler siliniyor...');
    await sql.unsafe('TRUNCATE neighborhoods, districts, provinces, dataset_meta');
  }
  const existing = (await sql`SELECT count(*)::int AS n FROM provinces`) as Array<{ n: number }>;
  if ((existing[0]?.n ?? 0) > 0) {
    if (ifEmpty) {
      console.log('Veritabanı zaten dolu, aktarma atlandı. (Yeniden yüklemek için --reset kullanın.)');
      return;
    }
    throw new Error('Tablolar dolu. Veriyi yeniden yüklemek için --reset ile çalıştırın.');
  }

  const { sources, skipped } = await discoverSources({ dir, files });
  if (sources.length === 0) throw new Error(`Veri bulunamadı: ${dir}`);
  if (skipped.length > 0) console.warn('Atlanan klasörler:', skipped.join(', '));

  const hashes: string[] = [];
  const counts = { provinces: 0, districts: 0, neighborhoods: 0 };

  await sql.begin(async (tx) => {
    for (const src of sources) {
      console.log(`Küme yükleniyor: ${src.label}`);
      const [p, d, n] = await Promise.all([
        loadFeatureCollection(src.province, `${src.label}/il`, validators.province),
        loadFeatureCollection(src.district, `${src.label}/ilce`, validators.district),
        loadFeatureCollection(src.neighborhood, `${src.label}/mahalle`, validators.neighborhood),
      ]);
      hashes.push(p.sha1, d.sha1, n.sha1);

      for (const f of p.collection.features) {
        const b = computeBBox(f.geometry);
        const c = computeCentroid(f.geometry, b);
        const geo = JSON.stringify(f.geometry);
        await tx`
          INSERT INTO provinces (id, name, population, search_key, min_lng, min_lat, max_lng, max_lat, centroid_lng, centroid_lat, geom)
          VALUES (${f.properties.IDARIID}::int, ${f.properties.ILADI}::text, ${Math.round(f.properties.NUFUS)}::int,
                  ${normalizeTr(f.properties.ILADI)}::text,
                  ${b[0]}::float8, ${b[1]}::float8, ${b[2]}::float8, ${b[3]}::float8, ${c.lng}::float8, ${c.lat}::float8,
                  ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geo}::text), 4326)), 3))
        `;
        counts.provinces++;
      }

      for (const f of d.collection.features) {
        const b = computeBBox(f.geometry);
        const c = computeCentroid(f.geometry, b);
        const geo = JSON.stringify(f.geometry);
        await tx`
          INSERT INTO districts (id, province_id, name, type, population, search_key, min_lng, min_lat, max_lng, max_lat, centroid_lng, centroid_lat, geom)
          VALUES (${f.properties.IDARIID}::int, ${f.properties.USTIDARIID}::int, ${f.properties.ILCEADI}::text,
                  ${f.properties.TIP}::text, ${Math.round(f.properties.NUFUS)}::int, ${normalizeTr(f.properties.ILCEADI)}::text,
                  ${b[0]}::float8, ${b[1]}::float8, ${b[2]}::float8, ${b[3]}::float8, ${c.lng}::float8, ${c.lat}::float8,
                  ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geo}::text), 4326)), 3))
        `;
        counts.districts++;
      }

      for (const f of n.collection.features) {
        const b = computeBBox(f.geometry);
        const c = computeCentroid(f.geometry, b);
        const geo = JSON.stringify(f.geometry);
        await tx`
          INSERT INTO neighborhoods (id, district_id, name, type, type_key, type_code, population, search_key, min_lng, min_lat, max_lng, max_lat, centroid_lng, centroid_lat, geom)
          VALUES (${f.properties.IDARIID}::int, ${f.properties.USTIDARIID}::int, ${f.properties.ADI}::text,
                  ${f.properties.TIP}::text, ${normalizeTr(f.properties.TIP)}::text, ${f.properties.TIPKOD}::int,
                  ${Math.round(f.properties.NUFUS)}::int, ${normalizeTr(f.properties.ADI)}::text,
                  ${b[0]}::float8, ${b[1]}::float8, ${b[2]}::float8, ${b[3]}::float8, ${c.lng}::float8, ${c.lat}::float8,
                  ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geo}::text), 4326)), 3))
        `;
        counts.neighborhoods++;
      }
    }

    const version = createHash('sha1').update(hashes.join('|')).digest('hex').slice(0, 12);
    const labels = sources.map((s) => s.label).join(',');
    await tx`
      INSERT INTO dataset_meta (id, version, sources) VALUES (1, ${version}::text, ${labels}::text)
      ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, sources = EXCLUDED.sources, imported_at = now()
    `;
  });

  await sql.unsafe('ANALYZE provinces; ANALYZE districts; ANALYZE neighborhoods;');
  console.log(
    `Tamamlandı: ${counts.provinces} il, ${counts.districts} ilçe, ${counts.neighborhoods} mahalle ` +
      `(${Math.round(performance.now() - started)} ms)`,
  );
}

main()
  .catch((err: unknown) => {
    console.error('İçe aktarma BAŞARISIZ:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => sql.close());
