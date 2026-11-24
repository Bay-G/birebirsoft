import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DataIntegrityError } from '../../core/errors.ts';

export interface GeoJsonSources {
  /** DATA_DIR */
  dir: string;
  /** Her veri klasöründe aranan dosya adları */
  files: { province: string; district: string; neighborhood: string };
}

export interface DataSource {
  /** Loglarda ve hata mesajlarında görünen ad: "." (kök) veya klasör adı ("1", "34" ...) */
  label: string;
  province: string;
  district: string;
  neighborhood: string;
}

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false,
  );

/**
 * DATA_DIR altında veri kümelerini bulur:
 *  - kökte üç dosya da varsa (data/il.geojson ...) o bir kümedir,
 *  - her alt klasörde üç dosya da varsa (data/1/, data/34/ ...) her biri ayrı bir kümedir.
 * Bir klasörde dosyaların yalnızca bir kısmı varsa hata verilir (eksik veri sessizce atlanmaz).
 * Hiç veri dosyası içermeyen klasörler atlanır ve `skipped` olarak döner.
 */
export async function discoverSources(cfg: GeoJsonSources): Promise<{ sources: DataSource[]; skipped: string[] }> {
  const entries = await readdir(cfg.dir, { withFileTypes: true }).catch((err: unknown) => {
    throw new DataIntegrityError(`Veri klasörü okunamadı (${cfg.dir}): ${(err as Error).message}`);
  });

  const sources: DataSource[] = [];
  const skipped: string[] = [];

  const check = async (label: string, base: string): Promise<void> => {
    const paths = {
      province: join(base, cfg.files.province),
      district: join(base, cfg.files.district),
      neighborhood: join(base, cfg.files.neighborhood),
    };
    const present = await Promise.all(Object.values(paths).map(exists));
    if (present.every(Boolean)) {
      sources.push({ label, ...paths });
    } else if (present.some(Boolean)) {
      const missing = Object.values(cfg.files).filter((_, i) => !present[i]);
      throw new DataIntegrityError(`"${label}" klasöründe eksik dosya(lar): ${missing.join(', ')}`);
    } else if (label !== '.') {
      skipped.push(label);
    }
  };

  await check('.', cfg.dir);
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const name of dirs) await check(name, join(cfg.dir, name));

  return { sources, skipped };
}
