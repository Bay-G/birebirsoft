import type { GeoRepository } from '../../data/geo-repository.ts';
import { NotFoundError } from '../../core/errors.ts';
import type { District, Province } from '../../domain/types.ts';

export class ProvinceService {
  constructor(private readonly repo: GeoRepository) {}

  list(q?: string): Promise<Province[]> {
    return this.repo.listProvinces(q);
  }

  async get(id: number): Promise<Province> {
    const p = await this.repo.getProvince(id);
    if (!p) throw new NotFoundError('İl', id);
    return p;
  }

  async districts(id: number): Promise<District[]> {
    await this.get(id);
    return this.repo.listDistricts({ provinceId: id });
  }
}
