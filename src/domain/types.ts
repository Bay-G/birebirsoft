/** [minLng, minLat, maxLng, maxLat] — WGS84 (CRS84, lng/lat sırası) */
export type BBox = [number, number, number, number];

export interface LngLat {
  lng: number;
  lat: number;
}

export type RegionLevel = 'province' | 'district' | 'neighborhood';

export interface Province {
  id: number;
  name: string;
  population: number;
  bbox: BBox;
  centroid: LngLat;
}

export interface District {
  id: number;
  provinceId: number;
  provinceName: string;
  name: string;
  /** Kaynak veri: "İlçe" | "Büyükşehir İlçesi" */
  type: string;
  population: number;
  bbox: BBox;
  centroid: LngLat;
}

export interface Neighborhood {
  id: number;
  districtId: number;
  districtName: string;
  provinceId: number;
  provinceName: string;
  /** Kaynak veriden olduğu gibi, örn. "Olucak Mh." */
  name: string;
  /** Kaynak veri: "Mahalle" | "Kırsal Mahalle" | "Ada" | "OSB" ... */
  type: string;
  /** Kaynak veri TIPKOD alanı (7: Mahalle/OSB, 8: Kırsal Mahalle, 9: Ada) */
  typeCode: number;
  population: number;
  bbox: BBox;
  centroid: LngLat;
}

export type AnyRegion = Province | District | Neighborhood;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface SearchHit {
  level: RegionLevel;
  id: number;
  name: string;
  /** Okunabilir hiyerarşi: "Adana / Feke / Olucak Mh." */
  path: string;
  population: number;
}

export interface LocateResult {
  matchedLevel: RegionLevel;
  province: Province;
  district: District | null;
  neighborhood: Neighborhood | null;
}

export interface DatasetStats {
  /** Üç dosyanın içerik hash'inden türetilen sürüm; ETag olarak da kullanılır. */
  version: string;
  loadedAt: string;
  loadDurationMs: number;
  counts: { provinces: number; districts: number; neighborhoods: number };
  /** Bellekte tutulan serileştirilmiş geometri boyutu (bayt) */
  geometryBytes: { provinces: number; districts: number; neighborhoods: number };
  neighborhoodTypes: string[];
  /** Yüklenen veri kümeleri (kök "." ve/veya alt klasör adları) */
  sources: string[];
}
