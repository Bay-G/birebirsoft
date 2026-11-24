import { SQL } from 'bun';
import { DataIntegrityError } from '../../core/errors.ts';
import type { Logger } from '../../core/logger.ts';
import type {
  BBox,
  DatasetStats,
  District,
  LngLat,
  LocateResult,
  Neighborhood,
  Province,
  RegionLevel,
  SearchHit,
} from '../../domain/types.ts';
import type { DistrictFilter, GeoRepository, NeighborhoodFilter } from '../geo-repository.ts';
import { normalizeTr } from '../geojson/text.ts';

export interface PostgisOptions {
  url: string;
  poolMax: number;
}

type BoxRow = {
  min_lng: number;
  min_lat: number;
  max_lng: number;
  max_lat: number;
  centroid_lng: number;
  centroid_lat: number;
};
type ProvinceRow = BoxRow & { id: number; name: string; population: number };
type DistrictRow = BoxRow & {
  id: number;
  province_id: number;
  province_name: string;
  name: string;
  type: string;
  population: number;
};
type NeighborhoodRow = BoxRow & {
  id: number;
  district_id: number;
  district_name: string;
  province_id: number;
  province_name: string;
  name: string;
  type: string;
  type_code: number;
  population: number;
};

const box = (r: BoxRow): { bbox: BBox; centroid: LngLat } => ({
  bbox: [r.min_lng, r.min_lat, r.max_lng, r.max_lat],
  centroid: { lng: r.centroid_lng, lat: r.centroid_lat },
});

const toProvince = (r: ProvinceRow): Province => ({ id: r.id, name: r.name, population: r.population, ...box(r) });

const toDistrict = (r: DistrictRow): District => ({
  id: r.id,
  provinceId: r.province_id,
  provinceName: r.province_name,
  name: r.name,
  type: r.type,
  population: r.population,
  ...box(r),
});

const toNeighborhood = (r: NeighborhoodRow): Neighborhood => ({
  id: r.id,
  districtId: r.district_id,
  districtName: r.district_name,
  provinceId: r.province_id,
  provinceName: r.province_name,
  name: r.name,
  type: r.type,
  typeCode: r.type_code,
  population: r.population,
  ...box(r),
});

/** LIKE desenindeki özel karakterleri (\, %, _) kaçırır. */
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

/**
 * PostgreSQL + PostGIS implementasyonu. GeoRepository sözleşmesini bellek içi sürümle aynı şekilde karşılar,
 * böylece service/controller katmanı değişmez.
 *
 * Notlar:
 *  - Tüm sorgular parametrelidir (SQL injection yok); tablo adları sabit, switch ile seçilir.
 *  - Sayısal kolonlar ::int / ::float8 ile açıkça cast edilir (bigint'in string dönmesini önler).
 *  - Sıralama `search_key, id` iledir (aksan katlanmış isim); bellek içi sürümdeki tr-locale sıralamayla
 *    birebir aynı olmayabilir (ç/ş/ğ gibi harflerin yeri).
 *  - Geometri ST_AsGeoJSON ile metin olarak alınır ve HTTP katmanına hazır string olarak verilir.
 */
export class PostgisRepository implements GeoRepository {
  private readonly sql: SQL;
  private _stats: DatasetStats | undefined;

  constructor(
    private readonly options: PostgisOptions,
    private readonly logger: Logger,
  ) {
    this.sql = new SQL({ url: options.url, max: options.poolMax });
  }

  async init(): Promise<void> {
    const started = performance.now();
    let meta: Array<{ version: string; sources: string }>;
    try {
      await this.sql`SELECT postgis_version() AS v`;
      meta = (await this.sql`SELECT version, sources FROM dataset_meta WHERE id = 1`) as typeof meta;
    } catch (err) {
      throw new DataIntegrityError(
        `PostgreSQL/PostGIS hazır değil veya şema yok (${(err as Error).message}). ` +
          `Veriyi içe aktarın: bun run import:postgis -- --reset`,
      );
    }
    const m = meta[0];
    if (!m) {
      throw new DataIntegrityError('Veritabanında veri yok. Önce içe aktarın: bun run import:postgis -- --reset');
    }

    const [counts] = (await this.sql`
      SELECT (SELECT count(*) FROM provinces)::int      AS provinces,
             (SELECT count(*) FROM districts)::int      AS districts,
             (SELECT count(*) FROM neighborhoods)::int  AS neighborhoods,
             (SELECT coalesce(sum(pg_column_size(geom)), 0) FROM provinces)::float8      AS g_provinces,
             (SELECT coalesce(sum(pg_column_size(geom)), 0) FROM districts)::float8      AS g_districts,
             (SELECT coalesce(sum(pg_column_size(geom)), 0) FROM neighborhoods)::float8  AS g_neighborhoods
    `) as Array<{
      provinces: number;
      districts: number;
      neighborhoods: number;
      g_provinces: number;
      g_districts: number;
      g_neighborhoods: number;
    }>;
    if (!counts || counts.provinces === 0) {
      throw new DataIntegrityError('Veritabanındaki il tablosu boş. Önce içe aktarın.');
    }
    const types = (await this.sql`SELECT DISTINCT type FROM neighborhoods ORDER BY type`) as Array<{ type: string }>;

    const loadDurationMs = Math.round(performance.now() - started);
    this._stats = {
      version: m.version,
      loadedAt: new Date().toISOString(),
      loadDurationMs,
      counts: { provinces: counts.provinces, districts: counts.districts, neighborhoods: counts.neighborhoods },
      // PostGIS'te "bellekte tutulan" değil, diskteki geometri boyutu (sıkıştırılmış olabilir)
      geometryBytes: {
        provinces: counts.g_provinces,
        districts: counts.g_districts,
        neighborhoods: counts.g_neighborhoods,
      },
      neighborhoodTypes: types.map((t) => t.type),
      sources: m.sources.split(',').filter(Boolean),
    };
    this.logger.info(
      { loadDurationMs, counts: this._stats.counts, version: this._stats.version, driver: 'postgis' },
      'PostGIS veri seti doğrulandı',
    );
  }

  async close(): Promise<void> {
    await this.sql.close();
  }

  stats(): DatasetStats {
    if (!this._stats) throw new Error('Repository henüz init edilmedi');
    return this._stats;
  }

  async listProvinces(q?: string): Promise<Province[]> {
    const nq = q ? likeEscape(normalizeTr(q)) : null;
    const rows = (await this.sql`
      SELECT id, name, population, min_lng, min_lat, max_lng, max_lat, centroid_lng, centroid_lat
      FROM provinces
      WHERE (${nq}::text IS NULL OR search_key LIKE '%' || ${nq}::text || '%')
      ORDER BY id
    `) as ProvinceRow[];
    return rows.map(toProvince);
  }

  async getProvince(id: number): Promise<Province | undefined> {
    const rows = (await this.sql`
      SELECT id, name, population, min_lng, min_lat, max_lng, max_lat, centroid_lng, centroid_lat
      FROM provinces WHERE id = ${id}::int
    `) as ProvinceRow[];
    return rows[0] ? toProvince(rows[0]) : undefined;
  }

  async listDistricts({ provinceId, q }: DistrictFilter): Promise<District[]> {
    const p = provinceId ?? null;
    const nq = q ? likeEscape(normalizeTr(q)) : null;
    const rows = (await this.sql`
      SELECT * FROM v_districts
      WHERE (${p}::int IS NULL OR province_id = ${p}::int)
        AND (${nq}::text IS NULL OR search_key LIKE '%' || ${nq}::text || '%')
      ORDER BY search_key, id
    `) as DistrictRow[];
    return rows.map(toDistrict);
  }

  async getDistrict(id: number): Promise<District | undefined> {
    const rows = (await this.sql`SELECT * FROM v_districts WHERE id = ${id}::int`) as DistrictRow[];
    return rows[0] ? toDistrict(rows[0]) : undefined;
  }

  async listNeighborhoods(f: NeighborhoodFilter): Promise<{ items: Neighborhood[]; total: number }> {
    const p = f.provinceId ?? null;
    const d = f.districtId ?? null;
    const t = f.type ? normalizeTr(f.type) : null;
    const q = f.q ? likeEscape(normalizeTr(f.q)) : null;

    const [rows, count] = await Promise.all([
      this.sql`
        SELECT * FROM v_neighborhoods
        WHERE (${p}::int IS NULL OR province_id = ${p}::int)
          AND (${d}::int IS NULL OR district_id = ${d}::int)
          AND (${t}::text IS NULL OR type_key = ${t}::text)
          AND (${q}::text IS NULL OR search_key LIKE '%' || ${q}::text || '%')
        ORDER BY search_key, id
        LIMIT ${f.limit}::int OFFSET ${f.offset}::int
      ` as Promise<NeighborhoodRow[]>,
      this.sql`
        SELECT count(*)::int AS total FROM v_neighborhoods
        WHERE (${p}::int IS NULL OR province_id = ${p}::int)
          AND (${d}::int IS NULL OR district_id = ${d}::int)
          AND (${t}::text IS NULL OR type_key = ${t}::text)
          AND (${q}::text IS NULL OR search_key LIKE '%' || ${q}::text || '%')
      ` as Promise<Array<{ total: number }>>,
    ]);
    return { items: rows.map(toNeighborhood), total: count[0]?.total ?? 0 };
  }

  async getNeighborhood(id: number): Promise<Neighborhood | undefined> {
    const rows = (await this.sql`SELECT * FROM v_neighborhoods WHERE id = ${id}::int`) as NeighborhoodRow[];
    return rows[0] ? toNeighborhood(rows[0]) : undefined;
  }

  async getGeometryJson(level: RegionLevel, id: number): Promise<string | undefined> {
    let rows: Array<{ g: string }>;
    switch (level) {
      case 'province':
        rows = (await this.sql`SELECT ST_AsGeoJSON(geom, 6) AS g FROM provinces WHERE id = ${id}::int`) as typeof rows;
        break;
      case 'district':
        rows = (await this.sql`SELECT ST_AsGeoJSON(geom, 6) AS g FROM districts WHERE id = ${id}::int`) as typeof rows;
        break;
      case 'neighborhood':
        rows = (await this.sql`SELECT ST_AsGeoJSON(geom, 6) AS g FROM neighborhoods WHERE id = ${id}::int`) as typeof rows;
        break;
    }
    return rows[0]?.g;
  }

  /** Tek sorguda çok geometri (N+1 sorgu sorununu önler). ID listesi JSON olarak tek parametre geçirilir. */
  async getGeometryJsonMany(level: RegionLevel, ids: number[]): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    if (ids.length === 0) return result;
    const json = JSON.stringify(ids);
    let rows: Array<{ id: number; g: string }>;
    switch (level) {
      case 'province':
        rows = (await this.sql`
          SELECT id, ST_AsGeoJSON(geom, 6) AS g FROM provinces
          WHERE id IN (SELECT value::int FROM jsonb_array_elements_text((${json}::text)::jsonb))
        `) as typeof rows;
        break;
      case 'district':
        rows = (await this.sql`
          SELECT id, ST_AsGeoJSON(geom, 6) AS g FROM districts
          WHERE id IN (SELECT value::int FROM jsonb_array_elements_text((${json}::text)::jsonb))
        `) as typeof rows;
        break;
      case 'neighborhood':
        rows = (await this.sql`
          SELECT id, ST_AsGeoJSON(geom, 6) AS g FROM neighborhoods
          WHERE id IN (SELECT value::int FROM jsonb_array_elements_text((${json}::text)::jsonb))
        `) as typeof rows;
        break;
    }
    for (const r of rows) result.set(r.id, r.g);
    return result;
  }

  async search(q: string, limit: number, level?: RegionLevel): Promise<SearchHit[]> {
    const nq = normalizeTr(q);
    if (!nq) return [];
    const esc = likeEscape(nq);
    const lvl = level ?? null;
    const rows = (await this.sql`
      SELECT level, id, name, path, population FROM (
        SELECT 'province'::text AS level, p.id, p.name, p.name AS path, p.population, p.search_key
        FROM provinces p
        UNION ALL
        SELECT 'district'::text, d.id, d.name, p.name || ' / ' || d.name, d.population, d.search_key
        FROM districts d JOIN provinces p ON p.id = d.province_id
        UNION ALL
        SELECT 'neighborhood'::text, n.id, n.name, p.name || ' / ' || d.name || ' / ' || n.name, n.population, n.search_key
        FROM neighborhoods n
        JOIN districts d ON d.id = n.district_id
        JOIN provinces p ON p.id = d.province_id
      ) s
      WHERE s.search_key LIKE '%' || ${esc}::text || '%'
        AND (${lvl}::text IS NULL OR s.level = ${lvl}::text)
      ORDER BY
        CASE WHEN s.search_key = ${nq}::text THEN 0
             WHEN s.search_key LIKE ${esc}::text || '%' THEN 1
             WHEN s.search_key LIKE '% ' || ${esc}::text || '%' THEN 2
             ELSE 3 END,
        CASE s.level WHEN 'province' THEN 0 WHEN 'district' THEN 1 ELSE 2 END,
        s.population DESC,
        s.name
      LIMIT ${limit}::int
    `) as Array<{ level: RegionLevel; id: number; name: string; path: string; population: number }>;
    return rows.map((r) => ({ level: r.level, id: r.id, name: r.name, path: r.path, population: r.population }));
  }

  async locate(lng: number, lat: number): Promise<LocateResult | null> {
    // GiST indeksi sayesinde her seviye için tek indeksli ST_Intersects sorgusu (sınır noktaları "içeride" sayılır).
    const nId = (await this.sql`
      SELECT id FROM neighborhoods
      WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326))
      ORDER BY id LIMIT 1
    `) as Array<{ id: number }>;
    if (nId[0]) {
      const neighborhood = await this.getNeighborhood(nId[0].id);
      if (neighborhood) {
        const [district, province] = await Promise.all([
          this.getDistrict(neighborhood.districtId),
          this.getProvince(neighborhood.provinceId),
        ]);
        if (province) return { matchedLevel: 'neighborhood', province, district: district ?? null, neighborhood };
      }
    }

    const dId = (await this.sql`
      SELECT id FROM districts
      WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326))
      ORDER BY id LIMIT 1
    `) as Array<{ id: number }>;
    if (dId[0]) {
      const district = await this.getDistrict(dId[0].id);
      const province = district ? await this.getProvince(district.provinceId) : undefined;
      if (district && province) return { matchedLevel: 'district', province, district, neighborhood: null };
    }

    const pId = (await this.sql`
      SELECT id FROM provinces
      WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326))
      ORDER BY id LIMIT 1
    `) as Array<{ id: number }>;
    if (pId[0]) {
      const province = await this.getProvince(pId[0].id);
      if (province) return { matchedLevel: 'province', province, district: null, neighborhood: null };
    }
    return null;
  }
}
