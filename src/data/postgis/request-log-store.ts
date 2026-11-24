import { SQL } from 'bun';
import { readFileSync } from 'node:fs';
import type { RequestLogRecord } from '../../core/request-log.ts';

const clip = (s: string | null, max: number): string | null =>
  s === null ? null : s.replace(/\u0000/g, '').slice(0, max);

/** request_logs tablosuna toplu yazar ve eski kayıtları temizler. */
export class PostgresRequestLogStore {
  private readonly sql: SQL;

  constructor(url: string, poolMax = 2) {
    this.sql = new SQL({ url, max: poolMax });
  }

  /** Tabloyu (yoksa) oluşturur. Başarısızsa fırlatır: servis açılışta fail-fast durur. */
  async init(): Promise<void> {
    await this.sql.unsafe(readFileSync(new URL('../../../db/request_logs.sql', import.meta.url), 'utf8'));
  }

  async insertBatch(batch: RequestLogRecord | RequestLogRecord[]): Promise<void> {
    // Gelen veri null/undefined ise veya dizi olup boşsa işlemi sonlandır
    if (!batch || (Array.isArray(batch) && batch.length === 0)) return;

    // Gelen veriyi kesin olarak bir diziye çevir
    const records = Array.isArray(batch) ? batch : [batch];

    // Veriyi temizle ve tablo kolon adlarına eşle
    const cleanRecords = records.map((r) => ({
      created_at: r.createdAt,
      request_id: clip(r.requestId, 100),
      method: clip(r.method, 16),
      path: clip(r.path, 500),
      status_code: r.statusCode,
      duration_ms: r.durationMs,
      error_code: clip(r.errorCode, 100),
      error_detail: clip(r.errorDetail, 2000),
      api_key: clip(r.apiKeyId, 16),
      client_ip: clip(r.clientIp, 64),
      query_string: clip(r.queryString, 500),
      lat: r.lat,
      lng: r.lng,
    }));

    const json = JSON.stringify(cleanRecords);

    // Bun, ::jsonb cast'li string'i ikinci kez JSON olarak kodluyor; bu yüzden önce ::text, sonra ::jsonb.
    await this.sql`
      INSERT INTO request_logs (created_at, request_id, method, path, status_code, duration_ms, error_code, error_detail,
                                api_key, client_ip, query_string, lat, lng)
      SELECT t.created_at::timestamptz, t.request_id, t.method, t.path, t.status_code, t.duration_ms,
             t.error_code, t.error_detail, t.api_key, t.client_ip, t.query_string, t.lat, t.lng
      FROM jsonb_to_recordset((${json}::text)::jsonb) AS t(
        created_at text, request_id text, method text, path text, status_code integer,
        duration_ms double precision, error_code text, error_detail text, api_key text,
        client_ip text, query_string text, lat double precision, lng double precision)
    `;
  }

  /** Saklama süresini aşan kayıtları siler; silinen satır sayısını döner. */
  async purgeOlderThan(days: number): Promise<number> {
    const rows = (await this.sql`
      WITH d AS (
        DELETE FROM request_logs WHERE created_at < now() - make_interval(days => ${days}::int) RETURNING 1
      )
      SELECT count(*)::int AS n FROM d
    `) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  async close(): Promise<void> {
    await this.sql.close();
  }
}