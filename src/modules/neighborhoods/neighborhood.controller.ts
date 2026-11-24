import { Elysia, t } from 'elysia';
import {
  DEFAULT_LIMIT,
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
import type { NeighborhoodService } from './neighborhood.service.ts';

export const neighborhoodController = (
  service: NeighborhoodService,
  geo: GeoJsonService,
  respond: GeoJsonResponder,
) =>
  new Elysia({ name: 'neighborhoods', prefix: '/v1/neighborhoods', tags: ['Neighborhoods'] })
    .get(
      '/',
      ({ query }) =>
        service.list({
          provinceId: query.provinceId,
          districtId: query.districtId,
          type: query.type,
          q: query.q,
          limit: query.limit ?? DEFAULT_LIMIT,
          offset: query.offset ?? 0,
        }),
      {
        query: t.Object({
          ...PaginationQuery,
          provinceId: t.Optional(t.Numeric({ minimum: 1 })),
          districtId: t.Optional(t.Numeric({ minimum: 1 })),
          type: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
          q: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        }),
        response: { 200: pageOf(NeighborhoodSchema), ...errorResponses },
        detail: {
          summary: 'neighborhoods',
          description: 'Sayfalı mahalle listesi (geometri olmadan). il/ilçe/tip/isim ile filtrelenebilir.',
        },
      },
    )
    .get('/:id', ({ params }) => service.get(params.id), {
      params: IdParams,
      response: { 200: NeighborhoodSchema, ...errorResponses },
      detail: { summary: 'neighborhoods/{id}' },
    })
    .get('/:id/geometry', async ({ params, request }) => respond(request, await geo.neighborhoodFeature(params.id)), {
      params: IdParams,
      detail: {
        summary: 'neighborhoods/{id}/geometry',
        responses: geoJsonResponseDoc('GeoJSON Feature', featureExample),
      },
    });
