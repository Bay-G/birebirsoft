import { Elysia, t } from 'elysia';
import {
  DistrictSchema,
  IdParams,
  ProvinceSchema,
  errorResponses,
  featureExample,
  geoJsonResponseDoc,
} from '../shared/schemas.ts';
import type { GeoJsonResponder } from '../shared/types.ts';
import type { GeoJsonService } from '../geojson/geojson.service.ts';
import type { ProvinceService } from './province.service.ts';

export const provinceController = (service: ProvinceService, geo: GeoJsonService, respond: GeoJsonResponder) =>
  new Elysia({ name: 'provinces', prefix: '/v1/provinces', tags: ['Provinces'] })
    .get('/', ({ query }) => service.list(query.q), {
      query: t.Object({ q: t.Optional(t.String({ minLength: 1, maxLength: 100, description: 'İsimde arama (Türkçe karakter duyarsız)' })) }),
      response: { 200: t.Array(ProvinceSchema), 400: errorResponses[400], 401: errorResponses[401] },
      detail: { summary: 'provinces', description: 'Tüm illeri (geometri olmadan) döner. `q` ile isme göre filtrelenebilir.' },
    })
    .get('/:id', ({ params }) => service.get(params.id), {
      params: IdParams,
      response: { 200: ProvinceSchema, ...errorResponses },
      detail: { summary: 'provinces/{id}', description: 'İdari ID ile tek il (isim, nüfus, bbox, merkez nokta).' },
    })
    .get('/:id/districts', ({ params }) => service.districts(params.id), {
      params: IdParams,
      response: { 200: t.Array(DistrictSchema), ...errorResponses },
      detail: { summary: 'provinces/{id}/districts', description: 'İle bağlı tüm ilçeleri ada göre sıralı döner.' },
    })
    .get(
      '/:id/geometry',
      async ({ params, request }) => respond(request, await geo.provinceFeature(params.id)),
      {
        params: IdParams,
        detail: {
          summary: 'provinces/{id}/geometry',
          description:
            'İlin sınır geometrisini GeoJSON Feature olarak döner. `properties` alanında il metadatası bulunur. ' +
            'ETag/If-None-Match ve `Accept-Encoding: gzip` desteklenir.',
          responses: geoJsonResponseDoc('GeoJSON Feature', featureExample),
        },
      },
    );
