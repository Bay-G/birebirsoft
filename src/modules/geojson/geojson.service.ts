import { BadRequestError, NotFoundError } from '../../core/errors.ts';
import type { GeoRepository } from '../../data/geo-repository.ts';
import type { AnyRegion, RegionLevel } from '../../domain/types.ts';

const featureOf = (entity: AnyRegion, geometryJson: string): string =>
  `{"type":"Feature","id":${entity.id},"properties":${JSON.stringify(entity)},"geometry":${geometryJson}}`;

const collectionOf = (features: string[]): string =>
  `{"type":"FeatureCollection","features":[${features.join(',')}]}`;

/** Tek bir response'ta döndürülecek en çok mahalle sayısı (güvenlik sınırı). */
const MAX_COLLECTION_ITEMS = 100_000;

/**
 * GeoJSON Feature / FeatureCollection üretir. Geometri repository'den ham JSON string olarak gelir
 * ve string birleştirme ile yazılır: büyük koordinat dizileri request başına yeniden parse/serialize EDİLMEZ.
 * Koleksiyonlar için geometriler tek çağrıda (getGeometryJsonMany) alınır.
 */
export class GeoJsonService {
  constructor(private readonly repo: GeoRepository) {}

  async provinceFeature(id: number): Promise<string> {
    const p = await this.repo.getProvince(id);
    if (!p) throw new NotFoundError('İl', id);
    return featureOf(p, await this.geometry('province', id));
  }

  async districtFeature(id: number): Promise<string> {
    const d = await this.repo.getDistrict(id);
    if (!d) throw new NotFoundError('İlçe', id);
    return featureOf(d, await this.geometry('district', id));
  }

  async neighborhoodFeature(id: number): Promise<string> {
    const n = await this.repo.getNeighborhood(id);
    if (!n) throw new NotFoundError('Mahalle', id);
    return featureOf(n, await this.geometry('neighborhood', id));
  }

  async provinceCollection(q?: string): Promise<string> {
    return this.collection('province', await this.repo.listProvinces(q));
  }

  async districtCollection(opts: { provinceId?: number; q?: string }): Promise<string> {
    if (opts.provinceId !== undefined && !(await this.repo.getProvince(opts.provinceId))) {
      throw new NotFoundError('İl', opts.provinceId);
    }
    return this.collection('district', await this.repo.listDistricts(opts));
  }

  /** Tüm Türkiye mahallelerini tek response'ta döndürmek istemediğimiz için il veya ilçe filtresi zorunlu. */
  async neighborhoodCollection(opts: { provinceId?: number; districtId?: number; type?: string }): Promise<string> {
    if (opts.provinceId === undefined && opts.districtId === undefined) {
      throw new BadRequestError('provinceId veya districtId parametrelerinden en az biri zorunlu');
    }
    if (opts.districtId !== undefined && !(await this.repo.getDistrict(opts.districtId))) {
      throw new NotFoundError('İlçe', opts.districtId);
    }
    if (opts.provinceId !== undefined && !(await this.repo.getProvince(opts.provinceId))) {
      throw new NotFoundError('İl', opts.provinceId);
    }
    const { items } = await this.repo.listNeighborhoods({ ...opts, limit: MAX_COLLECTION_ITEMS, offset: 0 });
    return this.collection('neighborhood', items);
  }

  private async collection(level: RegionLevel, items: AnyRegion[]): Promise<string> {
    const geometries = await this.repo.getGeometryJsonMany(
      level,
      items.map((i) => i.id),
    );
    return collectionOf(
      items.map((item) => {
        const g = geometries.get(item.id);
        if (!g) throw new NotFoundError(`Geometri (${level})`, item.id);
        return featureOf(item, g);
      }),
    );
  }

  private async geometry(level: RegionLevel, id: number): Promise<string> {
    const g = await this.repo.getGeometryJson(level, id);
    if (!g) throw new NotFoundError(`Geometri (${level})`, id);
    return g;
  }
}
