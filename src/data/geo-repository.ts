import type {
  District,
  DatasetStats,
  LocateResult,
  Neighborhood,
  Province,
  RegionLevel,
  SearchHit,
} from '../domain/types.ts';

export interface DistrictFilter {
  provinceId?: number;
  q?: string;
}

export interface NeighborhoodFilter {
  provinceId?: number;
  districtId?: number;
  type?: string;
  q?: string;
  limit: number;
  offset: number;
}

/**
 * Veri erişim sözleşmesi. Service katmanı yalnızca bu arayüze bağımlıdır.
 *
 * Bugünkü implementasyon: bellek içi GeoJSON (GeoJsonRepository).
 * İleride: PostGIS (PostgisRepository) — aynı arayüzü uygulayıp app.ts'te takılması yeterli.
 * Metotlar bu yüzden Promise döner (DB'ye geçişte imza değişmesin).
 *
 * Geometri, parse edilmiş nesne yerine HAM GeoJSON geometry JSON string'i olarak döner;
 * böylece HTTP katmanı yeniden serileştirme yapmadan doğrudan yazabilir
 * (PostGIS'te ST_AsGeoJSON zaten text döner).
 */
export interface GeoRepository {
  init(): Promise<void>;
  /** Bağlantıları kapatır (graceful shutdown). Bellek içi implementasyonda gerekmez. */
  close?(): Promise<void>;
  stats(): DatasetStats;

  listProvinces(q?: string): Promise<Province[]>;
  getProvince(id: number): Promise<Province | undefined>;

  listDistricts(filter: DistrictFilter): Promise<District[]>;
  getDistrict(id: number): Promise<District | undefined>;

  listNeighborhoods(filter: NeighborhoodFilter): Promise<{ items: Neighborhood[]; total: number }>;
  getNeighborhood(id: number): Promise<Neighborhood | undefined>;

  /** Ham GeoJSON geometry (JSON string). Kayıt yoksa undefined. */
  getGeometryJson(level: RegionLevel, id: number): Promise<string | undefined>;
  /** Çok kayıt için tek çağrıda geometri (veritabanında N+1 sorguyu önler). Bulunamayan id'ler map'te yoktur. */
  getGeometryJsonMany(level: RegionLevel, ids: number[]): Promise<Map<number, string>>;

  search(q: string, limit: number, level?: RegionLevel): Promise<SearchHit[]>;
  locate(lng: number, lat: number): Promise<LocateResult | null>;
}
