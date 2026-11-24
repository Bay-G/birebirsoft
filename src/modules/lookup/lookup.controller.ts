import { Elysia, t } from 'elysia';
import { DistrictSchema, NeighborhoodSchema, ProvinceSchema, errorResponses } from '../shared/schemas.ts';
import type { LookupService } from './lookup.service.ts';

const RegionLevelSchema = t.Union([t.Literal('province'), t.Literal('district'), t.Literal('neighborhood')]);

const SearchHitSchema = t.Object(
  {
    level: RegionLevelSchema,
    id: t.Integer(),
    name: t.String(),
    path: t.String({ description: 'Hiyerarşik yol: "Adana / Feke / Olucak Mh."' }),
    population: t.Integer(),
  },
  { examples: [{ level: 'neighborhood', id: 10301, name: 'Olucak Mh.', path: 'Adana / Feke / Olucak Mh.', population: 202 }] },
);

export const lookupController = (service: LookupService) =>
  new Elysia({ name: 'lookup', prefix: '/v1', tags: ['Lookup'] })
    .get('/search', ({ query }) => service.search(query.q, query.limit ?? 20, query.level), {
      query: t.Object({
        q: t.String({ minLength: 2, maxLength: 100, description: 'Aranacak metin (en az 2 karakter, Türkçe karakter duyarsız)' }),
        level: t.Optional(RegionLevelSchema),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
      }),
      response: { 200: t.Array(SearchHitSchema), 400: errorResponses[400], 401: errorResponses[401] },
      detail: {
        summary: 'search',
        description: 'Üç seviyede isim araması. Sıralama: birebir > önek > kelime başı > içerir; ardından seviye ve nüfus.',
      },
    })
    .get('/locate', ({ query }) => service.locate(query.lat, query.lng), {
      query: t.Object({
        lat: t.Numeric({ minimum: -90, maximum: 90, description: 'Enlem (WGS84)' }),
        lng: t.Numeric({ minimum: -180, maximum: 180, description: 'Boylam (WGS84)' }),
      }),
      response: {
        200: t.Object({
          matchedLevel: RegionLevelSchema,
          province: ProvinceSchema,
          district: t.Union([DistrictSchema, t.Null()]),
          neighborhood: t.Union([NeighborhoodSchema, t.Null()]),
        }),
        ...errorResponses,
      },
      detail: {
        summary: 'locate',
        description:
          'Verilen noktayı kapsayan mahalle, ilçe ve ili döner. Mahalle verisinde boşluk varsa ilçeye, o da yoksa ile düşer. ' +
          'Hiçbir bölgeye düşmezse 404 döner.',
      },
    })
    .get('/meta', () => service.meta(), {
      detail: {
        summary: 'meta',
        description: 'Veri sürümü, kayıt sayıları, bellekteki geometri boyutu ve süreç belleği. İzleme/analiz içindir.',
      },
    });
