/** Yalnızca bu serviste kullanılan GeoJSON alt kümesi (RFC 7946). */
export type Position = number[];

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Position[][];
}

export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: Position[][][];
}

export type AreaGeometry = PolygonGeometry | MultiPolygonGeometry;

export interface Feature<P> {
  type: 'Feature';
  properties: P;
  geometry: AreaGeometry;
}

export interface FeatureCollection<P> {
  type: 'FeatureCollection';
  name?: string;
  features: Feature<P>[];
}

/** Kaynak dosyalardaki ham property alanları (sayılar float olarak gelir: 1.0) */
export interface ProvinceProps {
  IDARIID: number;
  ILADI: string;
  USTIDARIID: number;
  NUFUS: number;
}

export interface DistrictProps {
  IDARIID: number;
  USTIDARIID: number;
  ILADI: string;
  ILCEADI: string;
  TIP: string;
  NUFUS: number;
}

export interface NeighborhoodProps {
  ADI: string;
  IDARIID: number;
  USTIDARIID: number;
  ILADI: string;
  ILCEADI: string;
  BUCAKADI: string;
  KOYADI: string;
  TIPKOD: number;
  TIP: string;
  NUFUS: number;
}
