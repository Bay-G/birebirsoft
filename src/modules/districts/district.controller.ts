import { Elysia, t } from 'elysia';
import {
  DEFAULT_LIMIT,
  DistrictSchema,
  IdParams,
  NeighborhoodSchema,
  PaginationQuery,
  errorResponses,
  featureExample,
  geoJsonResponseDoc,
  pageOf,
} from '../shared/schemas.ts';
import type { GeoJsonResponder } from '../shared/types.ts';
import type { GeoJsonService } from '../geojson/geojson.service.ts';
import type { DistrictService } from './district.service.ts';

export const districtController = (service: DistrictService, geo: GeoJsonService, respond: GeoJsonResponder) =>
  new Elysia({ name: 'districts', prefix: '/v1/districts', tags: ['Districts'] })
    .get('/', ({ query }) => service.list(query), {
      query: t.Object({
        provinceId: t.Optional(t.Numeric({ minimum: 1, description: 'İl ID filtresi' })),
        q: t.Optional(t.String({ minLength: 1, maxLength: 100, description: 'İsimde arama' })),
      }),
      response: { 200: t.Array(DistrictSchema), ...errorResponses },
      detail: { summary: 'districts', description: 'Tüm ilçeler (geometri olmadan). `provinceId` ve `q` ile filtrelenebilir.' },
    })
    .get('/:id', ({ params }) => service.get(params.id), {
      params: IdParams,
      response: { 200: DistrictSchema, ...errorResponses },
      detail: { summary: 'districts/{id}' },
    })
    .get(
      '/:id/neighborhoods',
      ({ params, query }) =>
        service.neighborhoods(params.id, {
          q: query.q,
          type: query.type,
          limit: query.limit ?? DEFAULT_LIMIT,
          offset: query.offset ?? 0,
        }),
      {
        params: IdParams,
        query: t.Object({
          ...PaginationQuery,
          q: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
          type: t.Optional(t.String({ minLength: 1, maxLength: 50, description: 'Örn. "Mahalle", "Kırsal Mahalle"' })),
        }),
        response: { 200: pageOf(NeighborhoodSchema), ...errorResponses },
        detail: { summary: 'districts/{id}/neighborhoods', description: 'Sayfalı mahalle listesi (geometri olmadan).' },
      },
    )
    .get('/:id/geometry', async ({ params, request }) => respond(request, await geo.districtFeature(params.id)), {
      params: IdParams,
      detail: {
        summary: 'districts/{id}/geometry',
        responses: geoJsonResponseDoc('GeoJSON Feature', featureExample),
      },
    });
