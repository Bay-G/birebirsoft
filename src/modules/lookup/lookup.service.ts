import { NotFoundError } from '../../core/errors.ts';
import type { GeoRepository } from '../../data/geo-repository.ts';
import type { DatasetStats, LocateResult, RegionLevel, SearchHit } from '../../domain/types.ts';

export class LookupService {
  constructor(private readonly repo: GeoRepository) {}

  search(q: string, limit: number, level?: RegionLevel): Promise<SearchHit[]> {
    return this.repo.search(q, limit, level);
  }

  async locate(lat: number, lng: number): Promise<LocateResult> {
    const r = await this.repo.locate(lng, lat);
    if (!r) throw new NotFoundError('Bu koordinatı kapsayan bölge', `${lat},${lng}`);
    return r;
  }

  meta(): DatasetStats & { process: { rssMb: number; heapUsedMb: number } } {
    const m = process.memoryUsage();
    return {
      ...this.repo.stats(),
      process: { rssMb: Math.round(m.rss / 1048576), heapUsedMb: Math.round(m.heapUsed / 1048576) },
    };
  }
}
