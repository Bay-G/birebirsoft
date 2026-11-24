import { createHash } from 'node:crypto';
import { DataIntegrityError } from '../../core/errors.ts';
import type { Logger } from '../../core/logger.ts';
import type {
  DatasetStats,
  District,
  LocateResult,
  Neighborhood,
  Province,
  RegionLevel,
  SearchHit,
} from '../../domain/types.ts';
import type { DistrictFilter, GeoRepository, NeighborhoodFilter } from '../geo-repository.ts';
import type { AreaGeometry } from './geojson.types.ts';
import { bboxContains, computeBBox, computeCentroid, pointInGeometry } from './geometry.ts';
import { loadFeatureCollection, validators } from './loader.ts';
import { discoverSources, type GeoJsonSources } from './sources.ts';
import { normalizeTr } from './text.ts';

interface SearchEntry {
  level: RegionLevel;
  id: number;
  key: string;
  name: string;
  path: string;
  population: number;
}

const LEVEL_ORDER: Record<RegionLevel, number> = { province: 0, district: 1, neighborhood: 2 };
const byNameTr = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, 'tr');

/**
 * Bellek içi GeoJSON repository.
 *
 * Bellek stratejisi:
 *  - Dosyalar yalnızca init() sırasında BİR KEZ okunur/parse edilir.
 *  - Parse edilmiş koordinat ağacı (milyonlarca küçük `number[]`) TUTULMAZ; geometri,
 *    sıkıştırılmış (whitespace'siz) JSON string'e çevrilip saklanır. V8'de string, nesne
 *    grafiğine göre kat kat az bellek tutar ve HTTP'ye yeniden serileştirmeden yazılır.
 *  - Liste/arama/filtreleme yalnızca küçük metadata nesneleri üzerinde çalışır.
 *  - Nokta sorguları (locate) bbox ile adayları daraltır ve yalnızca aday geometrileri parse eder.
 */
export class GeoJsonRepository implements GeoRepository {
  private provinces: Province[] = [];
  private provinceById = new Map<number, Province>();

  private districts: District[] = [];
  private districtById = new Map<number, District>();
  private districtsByProvince = new Map<number, District[]>();

  private neighborhoods: Neighborhood[] = [];
  private neighborhoodById = new Map<number, Neighborhood>();
  private neighborhoodsByDistrict = new Map<number, Neighborhood[]>();

  private geometry: Record<RegionLevel, Map<number, string>> = {
    province: new Map(),
    district: new Map(),
    neighborhood: new Map(),
  };

  private searchEntries: SearchEntry[] = [];
  private provinceKeys = new Map<number, string>();
  private districtKeys = new Map<number, string>();
  private neighborhoodTypes: string[] = [];
  private _stats: DatasetStats | undefined;

  constructor(
    private readonly sources: GeoJsonSources,
    private readonly logger: Logger,
  ) {}

  async init(): Promise<void> {
    const started = performance.now();

    const { sources, skipped } = await discoverSources(this.sources);
    if (sources.length === 0) {
      throw new DataIntegrityError(
        `Veri bulunamadı: ${this.sources.dir} içinde (kökte veya alt klasörlerde) ` +
          `${Object.values(this.sources.files).join(', ')} dosyaları yok`,
      );
    }
    if (skipped.length > 0) this.logger.warn({ skipped }, 'Veri dosyası içermeyen klasörler atlandı');

    const geometryBytes = { provinces: 0, districts: 0, neighborhoods: 0 };
    const types = new Set<string>();
    const hashes: string[] = [];
    let sourceBytes = 0;

    // Klasörler SIRAYLA işlenir: aynı anda yalnızca bir kümenin ham/parse edilmiş verisi bellekte durur,
    // işlenen küme kompakt string'lere dönüştürülüp serbest bırakılır (başlangıç bellek tepesini düşürür).
    for (const src of sources) {
      const [p, d, n] = await Promise.all([
        loadFeatureCollection(src.province, `${src.label}/il`, validators.province),
        loadFeatureCollection(src.district, `${src.label}/ilce`, validators.district),
        loadFeatureCollection(src.neighborhood, `${src.label}/mahalle`, validators.neighborhood),
      ]);
      hashes.push(p.sha1, d.sha1, n.sha1);
      sourceBytes += p.bytes + d.bytes + n.bytes;

      // --- İller ---
      for (const f of p.collection.features) {
        const id = f.properties.IDARIID;
        if (this.provinceById.has(id)) throw new DataIntegrityError(`${src.label}/il: yinelenen IDARIID ${id}`);
        const bbox = computeBBox(f.geometry);
        const province: Province = {
          id,
          name: f.properties.ILADI,
          population: f.properties.NUFUS,
          bbox,
          centroid: computeCentroid(f.geometry, bbox),
        };
        this.provinces.push(province);
        this.provinceById.set(id, province);
        geometryBytes.provinces += this.storeGeometry('province', id, f.geometry);
      }

      // --- İlçeler ---
      for (const f of d.collection.features) {
        const id = f.properties.IDARIID;
        if (this.districtById.has(id)) throw new DataIntegrityError(`${src.label}/ilce: yinelenen IDARIID ${id}`);
        const parent = this.provinceById.get(f.properties.USTIDARIID);
        if (!parent) {
          throw new DataIntegrityError(
            `${src.label}/ilce ${id} (${f.properties.ILCEADI}): üst il bulunamadı (USTIDARIID=${f.properties.USTIDARIID})`,
          );
        }
        const bbox = computeBBox(f.geometry);
        const district: District = {
          id,
          provinceId: parent.id,
          provinceName: parent.name,
          name: f.properties.ILCEADI,
          type: f.properties.TIP,
          population: f.properties.NUFUS,
          bbox,
          centroid: computeCentroid(f.geometry, bbox),
        };
        this.districts.push(district);
        this.districtById.set(id, district);
        pushTo(this.districtsByProvince, parent.id, district);
        geometryBytes.districts += this.storeGeometry('district', id, f.geometry);
      }

      // --- Mahalleler ---
      for (const f of n.collection.features) {
        const id = f.properties.IDARIID;
        if (this.neighborhoodById.has(id)) throw new DataIntegrityError(`${src.label}/mahalle: yinelenen IDARIID ${id}`);
        const parent = this.districtById.get(f.properties.USTIDARIID);
        if (!parent) {
          throw new DataIntegrityError(
            `${src.label}/mahalle ${id} (${f.properties.ADI}): üst ilçe bulunamadı (USTIDARIID=${f.properties.USTIDARIID})`,
          );
        }
        const bbox = computeBBox(f.geometry);
        const neighborhood: Neighborhood = {
          id,
          districtId: parent.id,
          districtName: parent.name,
          provinceId: parent.provinceId,
          provinceName: parent.provinceName,
          name: f.properties.ADI,
          type: f.properties.TIP,
          typeCode: f.properties.TIPKOD,
          population: f.properties.NUFUS,
          bbox,
          centroid: computeCentroid(f.geometry, bbox),
        };
        types.add(neighborhood.type);
        this.neighborhoods.push(neighborhood);
        this.neighborhoodById.set(id, neighborhood);
        pushTo(this.neighborhoodsByDistrict, parent.id, neighborhood);
        geometryBytes.neighborhoods += this.storeGeometry('neighborhood', id, f.geometry);
      }
      this.logger.debug({ source: src.label }, 'Veri kümesi yüklendi');
    }

    // --- Tüm kümeler yüklendikten sonra sıralama / indeksleme ---
    this.provinces.sort((a, b) => a.id - b.id);
    this.districts.sort(byNameTr);
    for (const list of this.districtsByProvince.values()) list.sort(byNameTr);
    this.neighborhoods.sort(byNameTr);
    for (const list of this.neighborhoodsByDistrict.values()) list.sort(byNameTr);
    this.neighborhoodTypes = [...types].sort((a, b) => a.localeCompare(b, 'tr'));

    // --- Veri tutarlılığı uyarıları (hata değil; kaynak veri kalitesi bilgisi) ---
    this.warnPopulationMismatches();

    this.buildSearchIndex();

    const loadDurationMs = Math.round(performance.now() - started);
    this._stats = {
      version: createHash('sha1').update(hashes.join('|')).digest('hex').slice(0, 12),
      loadedAt: new Date().toISOString(),
      loadDurationMs,
      counts: {
        provinces: this.provinces.length,
        districts: this.districts.length,
        neighborhoods: this.neighborhoods.length,
      },
      geometryBytes,
      neighborhoodTypes: this.neighborhoodTypes,
      sources: sources.map((s) => s.label),
    };
    this.logger.info(
      {
        loadDurationMs,
        sources: this._stats.sources,
        counts: this._stats.counts,
        sourceBytes,
        geometryBytes,
        version: this._stats.version,
      },
      'GeoJSON verisi belleğe yüklendi',
    );
  }

  stats(): DatasetStats {
    if (!this._stats) throw new Error('Repository henüz init edilmedi');
    return this._stats;
  }

  async listProvinces(q?: string): Promise<Province[]> {
    if (!q) return this.provinces;
    const nq = normalizeTr(q);
    return this.provinces.filter((p) => (this.provinceKeys.get(p.id) ?? '').includes(nq));
  }

  async getProvince(id: number): Promise<Province | undefined> {
    return this.provinceById.get(id);
  }

  async listDistricts({ provinceId, q }: DistrictFilter): Promise<District[]> {
    const base = provinceId === undefined ? this.districts : (this.districtsByProvince.get(provinceId) ?? []);
    if (!q) return base;
    const nq = normalizeTr(q);
    return base.filter((d) => (this.districtKeys.get(d.id) ?? '').includes(nq));
  }

  async getDistrict(id: number): Promise<District | undefined> {
    return this.districtById.get(id);
  }

  async listNeighborhoods(f: NeighborhoodFilter): Promise<{ items: Neighborhood[]; total: number }> {
    let list: Neighborhood[];
    if (f.districtId !== undefined) {
      list = this.neighborhoodsByDistrict.get(f.districtId) ?? [];
    } else if (f.provinceId !== undefined) {
      list = this.neighborhoods.filter((n) => n.provinceId === f.provinceId);
    } else {
      list = this.neighborhoods;
    }
    if (f.type) {
      const t = normalizeTr(f.type);
      list = list.filter((n) => normalizeTr(n.type) === t);
    }
    if (f.q) {
      const nq = normalizeTr(f.q);
      list = list.filter((n) => normalizeTr(n.name).includes(nq));
    }
    return { items: list.slice(f.offset, f.offset + f.limit), total: list.length };
  }

  async getNeighborhood(id: number): Promise<Neighborhood | undefined> {
    return this.neighborhoodById.get(id);
  }

  async getGeometryJson(level: RegionLevel, id: number): Promise<string | undefined> {
    return this.geometry[level].get(id);
  }

  async getGeometryJsonMany(level: RegionLevel, ids: number[]): Promise<Map<number, string>> {
    const store = this.geometry[level];
    const result = new Map<number, string>();
    for (const id of ids) {
      const g = store.get(id);
      if (g !== undefined) result.set(id, g);
    }
    return result;
  }

  async search(q: string, limit: number, level?: RegionLevel): Promise<SearchHit[]> {
    const nq = normalizeTr(q);
    if (!nq) return [];
    const scored: Array<{ score: number; e: SearchEntry }> = [];
    for (const e of this.searchEntries) {
      if (level && e.level !== level) continue;
      const idx = e.key.indexOf(nq);
      if (idx === -1) continue;
      // 0: birebir, 1: önek, 2: kelime başı, 3: içerir
      const score = e.key === nq ? 0 : idx === 0 ? 1 : e.key[idx - 1] === ' ' ? 2 : 3;
      scored.push({ score, e });
    }
    scored.sort(
      (a, b) =>
        a.score - b.score ||
        LEVEL_ORDER[a.e.level] - LEVEL_ORDER[b.e.level] ||
        b.e.population - a.e.population ||
        a.e.name.localeCompare(b.e.name, 'tr'),
    );
    return scored.slice(0, limit).map(({ e }) => ({
      level: e.level,
      id: e.id,
      name: e.name,
      path: e.path,
      population: e.population,
    }));
  }

  async locate(lng: number, lat: number): Promise<LocateResult | null> {
    // 1) Mahalle: bbox ile ele, kalan adaylarda point-in-polygon
    for (const n of this.neighborhoods) {
      if (!bboxContains(n.bbox, lng, lat)) continue;
      if (this.contains('neighborhood', n.id, lng, lat)) {
        const district = this.districtById.get(n.districtId) ?? null;
        const province = this.provinceById.get(n.provinceId);
        if (province) return { matchedLevel: 'neighborhood', province, district, neighborhood: n };
      }
    }
    // 2) Mahalle verisinde boşluk varsa ilçeye düş
    for (const d of this.districts) {
      if (!bboxContains(d.bbox, lng, lat)) continue;
      const province = this.provinceById.get(d.provinceId);
      if (province && this.contains('district', d.id, lng, lat)) {
        return { matchedLevel: 'district', province, district: d, neighborhood: null };
      }
    }
    // 3) Son olarak il
    for (const p of this.provinces) {
      if (bboxContains(p.bbox, lng, lat) && this.contains('province', p.id, lng, lat)) {
        return { matchedLevel: 'province', province: p, district: null, neighborhood: null };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- internals

  private storeGeometry(level: RegionLevel, id: number, geometry: AreaGeometry): number {
    // JSON.stringify koordinatları kompakt yazar (kaynaktaki "[ 36.41, 38.16 ]" boşlukları kalkar).
    const json = JSON.stringify(geometry);
    this.geometry[level].set(id, json);
    return json.length;
  }

  private contains(level: RegionLevel, id: number, lng: number, lat: number): boolean {
    const json = this.geometry[level].get(id);
    if (!json) return false;
    return pointInGeometry(JSON.parse(json) as AreaGeometry, lng, lat);
  }

  private buildSearchIndex(): void {
    for (const p of this.provinces) {
      const key = normalizeTr(p.name);
      this.provinceKeys.set(p.id, key);
      this.searchEntries.push({ level: 'province', id: p.id, key, name: p.name, path: p.name, population: p.population });
    }
    for (const d of this.districts) {
      const key = normalizeTr(d.name);
      this.districtKeys.set(d.id, key);
      this.searchEntries.push({
        level: 'district',
        id: d.id,
        key,
        name: d.name,
        path: `${d.provinceName} / ${d.name}`,
        population: d.population,
      });
    }
    for (const n of this.neighborhoods) {
      this.searchEntries.push({
        level: 'neighborhood',
        id: n.id,
        key: normalizeTr(n.name),
        name: n.name,
        path: `${n.provinceName} / ${n.districtName} / ${n.name}`,
        population: n.population,
      });
    }
  }

  private warnPopulationMismatches(): void {
    for (const d of this.districts) {
      const list = this.neighborhoodsByDistrict.get(d.id) ?? [];
      const sum = list.reduce((s, n) => s + n.population, 0);
      if (sum !== d.population) {
        this.logger.warn(
          { districtId: d.id, district: d.name, districtPopulation: d.population, neighborhoodSum: sum },
          'Kaynak veri: ilçe nüfusu ile mahalle nüfus toplamı uyuşmuyor',
        );
      }
    }
  }
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}
