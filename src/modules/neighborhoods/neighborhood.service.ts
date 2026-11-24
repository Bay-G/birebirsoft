import { NotFoundError } from '../../core/errors.ts';
import type { GeoRepository } from '../../data/geo-repository.ts';
import type { Neighborhood, Page } from '../../domain/types.ts';

export interface NeighborhoodQuery {
  provinceId?: number;
  districtId?: number;
  type?: string;
  q?: string;
  limit: number;
  offset: number;
}

export class NeighborhoodService {
  constructor(private readonly repo: GeoRepository) {}

  async list(query: NeighborhoodQuery): Promise<Page<Neighborhood>> {
    if (query.provinceId !== undefined && !(await this.repo.getProvince(query.provinceId))) {
      throw new NotFoundError('İl', query.provinceId);
    }
    if (query.districtId !== undefined && !(await this.repo.getDistrict(query.districtId))) {
      throw new NotFoundError('İlçe', query.districtId);
    }
    const { items, total } = await this.repo.listNeighborhoods(query);
    return { items, total, limit: query.limit, offset: query.offset };
  }

  async get(id: number): Promise<Neighborhood> {
    const n = await this.repo.getNeighborhood(id);
    if (!n) throw new NotFoundError('Mahalle', id);
    return n;
  }
}
