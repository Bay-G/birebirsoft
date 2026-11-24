import { Elysia, t } from 'elysia';
import { featureCollectionExample, geoJsonResponseDoc } from '../shared/schemas.ts';
import type { GeoJsonResponder } from '../shared/types.ts';
import type { GeoJsonService } from './geojson.service.ts';

const q = t.Optional(t.String({ minLength: 1, maxLength: 100, description: 'İsimde arama' }));

/** Harita istemcileri için toplu FeatureCollection endpoint'leri. */
export const geoJsonController = (geo: GeoJsonService, respond: GeoJsonResponder) =>
  new Elysia({ name: 'geojson', prefix: '/v1/geojson', tags: ['GeoJSON'] })
    .get('/provinces', async ({ query, request }) => respond(request, await geo.provinceCollection(query.q)), {
      query: t.Object({ q }),
      detail: {
        summary: 'geojson/provinces',
        description: 'Tüm illerin sınırları tek FeatureCollection içinde. Not: yanıt yüzlerce KB olabilir; Swagger Try it out bunu çizerken yavaşlayabilir, curl veya /demo önerilir.',
        responses: geoJsonResponseDoc('GeoJSON FeatureCollection', featureCollectionExample),
      },
    })
    .get('/districts', async ({ query, request }) => respond(request, await geo.districtCollection(query)), {
      query: t.Object({ provinceId: t.Optional(t.Numeric({ minimum: 1 })), q }),
      detail: {
        summary: 'geojson/districts',
        description: '`provinceId` verilirse yalnızca o ilin ilçeleri; verilmezse tüm ilçeler (büyük olabilir, gzip önerilir).',
        responses: geoJsonResponseDoc('GeoJSON FeatureCollection', featureCollectionExample),
      },
    })
    .get('/neighborhoods', async ({ query, request }) => respond(request, await geo.neighborhoodCollection(query)), {
      query: t.Object({
        provinceId: t.Optional(t.Numeric({ minimum: 1 })),
        districtId: t.Optional(t.Numeric({ minimum: 1 })),
        type: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
      }),
      detail: {
        summary: 'geojson/neighborhoods',
        description: 'Yanıt boyutunu sınırlamak için `provinceId` veya `districtId`\'den en az biri zorunludur.',
        responses: geoJsonResponseDoc('GeoJSON FeatureCollection', featureCollectionExample),
      },
    });
