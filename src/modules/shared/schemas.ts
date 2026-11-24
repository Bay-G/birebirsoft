import { t } from 'elysia';

export const BBoxSchema = t.Tuple([t.Number(), t.Number(), t.Number(), t.Number()], {
  description: 'Sınır kutusu: [minLng, minLat, maxLng, maxLat] (WGS84 / CRS84, boylam-enlem sırası)',
  examples: [[34.659129, 36.538287, 36.410288, 38.422703]],
});

export const LngLatSchema = t.Object(
  { lng: t.Number({ description: 'Boylam' }), lat: t.Number({ description: 'Enlem' }) },
  { examples: [{ lng: 35.5866, lat: 37.396458 }] },
);

export const ProvinceSchema = t.Object(
  {
    id: t.Integer({ description: 'İdari ID (kaynak: IDARIID)' }),
    name: t.String(),
    population: t.Integer(),
    bbox: BBoxSchema,
    centroid: LngLatSchema,
  },
  {
    title: 'Province',
    examples: [
      {
        id: 1,
        name: 'Adana',
        population: 2183167,
        bbox: [34.659129, 36.538287, 36.410288, 38.422703],
        centroid: { lng: 35.5866, lat: 37.396458 },
      },
    ],
  },
);

export const DistrictSchema = t.Object(
  {
    id: t.Integer(),
    provinceId: t.Integer(),
    provinceName: t.String(),
    name: t.String(),
    type: t.String({ description: '"İlçe" | "Büyükşehir İlçesi"' }),
    population: t.Integer(),
    bbox: BBoxSchema,
    centroid: LngLatSchema,
  },
  {
    title: 'District',
    examples: [
      {
        id: 1329,
        provinceId: 1,
        provinceName: 'Adana',
        name: 'Feke',
        type: 'İlçe',
        population: 17214,
        bbox: [35.7, 37.5, 36.2, 38.0],
        centroid: { lng: 35.92, lat: 37.8 },
      },
    ],
  },
);

export const NeighborhoodSchema = t.Object(
  {
    id: t.Integer(),
    districtId: t.Integer(),
    districtName: t.String(),
    provinceId: t.Integer(),
    provinceName: t.String(),
    name: t.String({ description: 'Kaynak veriden olduğu gibi (örn. "Olucak Mh.")' }),
    type: t.String({ description: '"Mahalle" | "Kırsal Mahalle" | "Ada" | "OSB"' }),
    typeCode: t.Integer({ description: '7: Mahalle/OSB, 8: Kırsal Mahalle, 9: Ada' }),
    population: t.Integer(),
    bbox: BBoxSchema,
    centroid: LngLatSchema,
  },
  {
    title: 'Neighborhood',
    examples: [
      {
        id: 10301,
        districtId: 1329,
        districtName: 'Feke',
        provinceId: 1,
        provinceName: 'Adana',
        name: 'Olucak Mh.',
        type: 'Kırsal Mahalle',
        typeCode: 8,
        population: 202,
        bbox: [35.85, 37.86, 35.9, 37.92],
        centroid: { lng: 35.88, lat: 37.89 },
      },
    ],
  },
);

export const pageOf = <T extends ReturnType<typeof t.Object>>(item: T) =>
  t.Object({
    items: t.Array(item),
    total: t.Integer({ description: 'Filtreye uyan toplam kayıt' }),
    limit: t.Integer(),
    offset: t.Integer(),
  });

export const ErrorSchema = t.Object(
  {
    error: t.Object({
      code: t.String({ description: 'Makine tarafından okunabilir hata kodu' }),
      message: t.String(),
      details: t.Optional(t.Unknown()),
    }),
    requestId: t.String({ description: 'Loglarla eşleştirmek için istek kimliği' }),
  },
  {
    title: 'Error',
    examples: [{ error: { code: 'NOT_FOUND', message: 'İl bulunamadı: 999' }, requestId: 'b5f1c3a2-9d7e-4c1a-8f10-3d2f6c7a9e11' }],
  },
);

/** Swagger'da listelenecek ortak hata yanıtları */
export const errorResponses = {
  400: ErrorSchema,
  401: ErrorSchema,
  404: ErrorSchema,
} as const;

export const IdParams = t.Object({ id: t.Numeric({ minimum: 1, description: 'İdari ID (IDARIID)' }) });

export const PaginationQuery = {
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500, default: 100, description: 'Sayfa boyutu (varsayılan 100, en çok 500)' })),
  offset: t.Optional(t.Numeric({ minimum: 0, default: 0, description: 'Atlanacak kayıt sayısı' })),
};

export const DEFAULT_LIMIT = 100;

const errorDoc = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object' as const,
        properties: {
          error: {
            type: 'object' as const,
            properties: { code: { type: 'string' as const }, message: { type: 'string' as const } },
          },
          requestId: { type: 'string' as const },
        },
      },
      example: { error: { code: 'NOT_FOUND', message: 'Kayıt bulunamadı: 999' }, requestId: 'b5f1c3a2-9d7e-4c1a-8f10-3d2f6c7a9e11' },
    },
  },
});

/** Raw GeoJSON response'ları (elle yazılan gövde) için OpenAPI açıklaması */
export const geoJsonResponseDoc = (description: string, example: unknown) => ({
  200: {
    description,
    content: { 'application/geo+json': { schema: { type: 'object' as const }, example } },
  },
  304: { description: 'İçerik değişmedi (If-None-Match eşleşti)' },
  400: errorDoc('Geçersiz parametre'),
  401: errorDoc('API anahtarı eksik veya geçersiz'),
  404: errorDoc('Kayıt bulunamadı'),
});

export const featureExample = {
  type: 'Feature',
  id: 1,
  properties: { id: 1, name: 'Adana', population: 2183167 },
  geometry: { type: 'Polygon', coordinates: [[[36.410288, 38.167549], [36.409876, 38.168696], [36.410288, 38.167549]]] },
};

export const featureCollectionExample = { type: 'FeatureCollection', features: [featureExample] };
