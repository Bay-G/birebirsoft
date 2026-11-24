import type { BBox, LngLat } from '../../domain/types.ts';
import type { AreaGeometry, Position } from './geojson.types.ts';

function polygonsOf(g: AreaGeometry): Position[][][] {
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
}

export function computeBBox(g: AreaGeometry): BBox {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const poly of polygonsOf(g)) {
    for (const ring of poly) {
      for (const p of ring) {
        const lng = p[0] as number;
        const lat = p[1] as number;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

/** Dış halkaların alan-ağırlıklı ağırlık merkezi (delikler yok sayılır). Dejenere ise bbox merkezi. */
export function computeCentroid(g: AreaGeometry, bbox: BBox): LngLat {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const poly of polygonsOf(g)) {
    const ring = poly[0];
    if (!ring || ring.length < 4) continue;
    let a = 0;
    let x = 0;
    let y = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x0, y0] = ring[j] as [number, number];
      const [x1, y1] = ring[i] as [number, number];
      const cross = x0 * y1 - x1 * y0;
      a += cross;
      x += (x0 + x1) * cross;
      y += (y0 + y1) * cross;
    }
    // İşaretli alanı toplamak yerine mutlak alanla ağırlıklandırıyoruz (halka yönünden bağımsız).
    if (a !== 0) {
      const w = Math.abs(a);
      area += w;
      cx += (x / (3 * a)) * w;
      cy += (y / (3 * a)) * w;
    }
  }
  if (area === 0) return { lng: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2 };
  return { lng: round6(cx / area), lat: round6(cy / area) };
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export function bboxContains(b: BBox, lng: number, lat: number): boolean {
  return lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
}

function inRing(ring: Position[], lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Ray-casting; dış halka içinde ve hiçbir delikte olmayan nokta "içeride" sayılır. */
export function pointInGeometry(g: AreaGeometry, lng: number, lat: number): boolean {
  for (const poly of polygonsOf(g)) {
    const [outer, ...holes] = poly;
    if (!outer || !inRing(outer, lng, lat)) continue;
    if (holes.some((h) => inRing(h, lng, lat))) continue;
    return true;
  }
  return false;
}
