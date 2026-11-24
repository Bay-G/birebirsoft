import { NotFoundError } from '../../core/errors.ts';
import type { GeoRepository } from '../../data/geo-repository.ts';
import type { District, Neighborhood, Page } from '../../domain/types.ts';

export class DistrictService {
  constructor(private readonly repo: GeoRepository) {}

  async list(filter: { provinceId?: number; q?: string }): Promise<District[]> {
    if (filter.provinceId !== undefined && !(await this.repo.getProvince(filter.provinceId))) {
      throw new NotFoundError('İl', filter.provinceId);
    }
    return this.repo.listDistricts(filter);
  }

  async get(id: number): Promise<District> {
    const d = await this.repo.getDistrict(id);
    if (!d) throw new NotFoundError('İlçe', id);
    return d;
  }

  async neighborhoods(
    id: number,
    opts: { q?: string; type?: string; limit: number; offset: number },
  ): Promise<Page<Neighborhood>> {
    await this.get(id);
    const { items, total } = await this.repo.listNeighborhoods({ districtId: id, ...opts });
    return { items, total, limit: opts.limit, offset: opts.offset };
  }
}
