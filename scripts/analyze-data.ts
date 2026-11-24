/**
 * GeoJSON dosyalarının yapısını, geometri tiplerini ve boyutlarını raporlar.
 * Kullanım: bun scripts/analyze-data.ts [dataDir]
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2] ?? './data';
const countCoords = (c: unknown): number =>
  Array.isArray(c) && typeof c[0] === 'number' ? 1 : (c as unknown[]).reduce<number>((s, x) => s + countCoords(x), 0);

for (const file of ['il.geojson', 'ilce.geojson', 'mahalle.geojson']) {
  const raw = await readFile(join(dir, file), 'utf8');
  const fc = JSON.parse(raw) as { features: Array<{ properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }> };
  const types: Record<string, number> = {};
  let coords = 0;
  let compact = 0;
  for (const f of fc.features) {
    types[f.geometry.type] = (types[f.geometry.type] ?? 0) + 1;
    coords += countCoords(f.geometry.coordinates);
    compact += JSON.stringify(f.geometry).length;
  }
  console.log(`\n${file}`);
  console.log(`  boyut: ${(raw.length / 1024).toFixed(0)} KB | kompakt geometri: ${(compact / 1024).toFixed(0)} KB`);
  console.log(`  feature: ${fc.features.length} | koordinat: ${coords} | ort. ${(coords / fc.features.length).toFixed(0)}/feature`);
  console.log(`  geometri tipleri:`, types);
  console.log(`  property alanları:`, Object.keys(fc.features[0]?.properties ?? {}).join(', '));
}
