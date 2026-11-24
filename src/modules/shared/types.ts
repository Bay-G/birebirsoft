/** Controller'ların ham GeoJSON string'ini ETag/gzip ile HTTP response'una çeviren fonksiyonu. */
export type GeoJsonResponder = (request: Request, body: string) => Response;
