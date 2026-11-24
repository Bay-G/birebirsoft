import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DataIntegrityError } from '../../core/errors.ts';
import type {
  AreaGeometry,
  DistrictProps,
  Feature,
  FeatureCollection,
  NeighborhoodProps,
  ProvinceProps,
} from './geojson.types.ts';

export interface LoadedCollection<P> {
  collection: FeatureCollection<P>;
  sha1: string;
  bytes: number;
}

type Validator<P> = (props: Record<string, unknown>) => props is Record<string, unknown> & P;

/** Dosyayı bir kez okur, parse eder ve yapısını doğrular. Yalnızca başlangıçta çağrılır. */
export async function loadFeatureCollection<P>(
  path: string,
  label: string,
  isValidProps: Validator<P>,
): Promise<LoadedCollection<P>> {
  const raw = await readFile(path).catch((err: unknown) => {
    throw new DataIntegrityError(`${label}: dosya okunamadı (${path}): ${(err as Error).message}`);
  });
  const sha1 = createHash('sha1').update(raw).digest('hex');

  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    throw new DataIntegrityError(`${label}: geçersiz JSON: ${(err as Error).message}`);
  }

  const fc = json as Partial<FeatureCollection<unknown>>;
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new DataIntegrityError(`${label}: FeatureCollection bekleniyordu`);
  }

  fc.features.forEach((f, i) => {
    const feat = f as Partial<Feature<Record<string, unknown>>>;
    if (feat?.type !== 'Feature' || !feat.properties || !isAreaGeometry(feat.geometry)) {
      throw new DataIntegrityError(`${label}: features[${i}] geçerli bir Polygon/MultiPolygon Feature değil`);
    }
    if (!isValidProps(feat.properties)) {
      throw new DataIntegrityError(`${label}: features[${i}] property alanları beklenen şemaya uymuyor`);
    }
  });

  return { collection: fc as FeatureCollection<P>, sha1, bytes: raw.byteLength };
}

function isAreaGeometry(g: unknown): g is AreaGeometry {
  const geom = g as { type?: string; coordinates?: unknown } | null | undefined;
  return (
    !!geom &&
    (geom.type === 'Polygon' || geom.type === 'MultiPolygon') &&
    Array.isArray(geom.coordinates) &&
    geom.coordinates.length > 0
  );
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Kaynakta ID/nüfus "1.0" gibi float gelir; JS'te zaten tam sayıdır, Number.isInteger(1.0) === true. */
export const validators = {
  province: ((p) =>
    isInt(p['IDARIID']) && isStr(p['ILADI']) && isInt(p['USTIDARIID']) && isNum(p['NUFUS'])) as Validator<
    ProvinceProps
  >,
  district: ((p) =>
    isInt(p['IDARIID']) &&
    isInt(p['USTIDARIID']) &&
    isStr(p['ILADI']) &&
    isStr(p['ILCEADI']) &&
    isStr(p['TIP']) &&
    isNum(p['NUFUS'])) as Validator<DistrictProps>,
  neighborhood: ((p) =>
    isStr(p['ADI']) &&
    isInt(p['IDARIID']) &&
    isInt(p['USTIDARIID']) &&
    isStr(p['ILADI']) &&
    isStr(p['ILCEADI']) &&
    isInt(p['TIPKOD']) &&
    isStr(p['TIP']) &&
    isNum(p['NUFUS'])) as Validator<NeighborhoodProps>,
};
