import { describe, expect, it } from 'bun:test';
import { loadConfig } from '../src/config/env.ts';
import { BatchedRequestLogSink, type RequestLogRecord } from '../src/core/request-log.ts';

const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const rec = (i: number): RequestLogRecord => ({
  createdAt: new Date().toISOString(),
  requestId: `r${i}`,
  method: 'GET',
  path: '/v1/x',
  statusCode: 200,
  durationMs: 1,
  errorCode: null,
  errorDetail: null,
  apiKeyId: null,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('BatchedRequestLogSink', () => {
  it('toplu yazar, sıra korunur, kayıp olmaz', async () => {
    const written: string[][] = [];
    const s = new BatchedRequestLogSink(async (b) => void written.push(b.map((x) => x.requestId)), quiet, {
      batchSize: 3,
      flushIntervalMs: 10_000,
    });
    for (let i = 0; i < 7; i++) s.record(rec(i));
    await sleep(20);
    await s.close();
    expect(written.flat()).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6']);
  });

  it('zamanlayıcıyla yazar', async () => {
    const written: number[] = [];
    const s = new BatchedRequestLogSink(async (b) => void written.push(b.length), quiet, {
      batchSize: 100,
      flushIntervalMs: 30,
    });
    s.start();
    s.record(rec(1));
    s.record(rec(2));
    await sleep(80);
    expect(written).toEqual([2]);
    await s.close();
  });

  it('kuyruk sınırı: en eskiler atılır', () => {
    const s = new BatchedRequestLogSink(async () => { throw new Error('db yok'); }, quiet, {
      maxQueue: 5,
      batchSize: 1000,
      flushIntervalMs: 10_000,
    });
    for (let i = 0; i < 12; i++) s.record(rec(i));
    expect(s.stats).toEqual({ queued: 5, dropped: 7 });
  });

  it('geçici veritabanı hatasında kayıt kaybı olmaz', async () => {
    let fail = true;
    const written: string[] = [];
    const s = new BatchedRequestLogSink(
      async (b) => {
        if (fail) throw new Error('kesik');
        written.push(...b.map((x) => x.requestId));
      },
      quiet,
      { batchSize: 2, flushIntervalMs: 10_000 },
    );
    s.record(rec(1));
    s.record(rec(2));
    await sleep(20);
    expect(s.stats.queued).toBe(2);
    fail = false;
    await s.flush();
    expect(written).toEqual(['r1', 'r2']);
  });

  it('kalıcı hatada grup atılır, kuyruk kilitlenmez', async () => {
    const s = new BatchedRequestLogSink(async () => { throw new Error('bozuk'); }, quiet, {
      batchSize: 2,
      flushIntervalMs: 10_000,
      maxConsecutiveFailures: 3,
    });
    s.record(rec(1));
    s.record(rec(2));
    for (let i = 0; i < 4; i++) await s.flush();
    expect(s.stats).toEqual({ queued: 0, dropped: 2 });
  });
});

describe('request log ayarları', () => {
  const base = { API_KEYS: 'k' };
  it('varsayılan kapalı', () => {
    expect(loadConfig(base).requestLog).toEqual({ enabled: false });
  });
  it('REQUEST_LOG_DB=true iken DATABASE_URL zorunlu', () => {
    expect(() => loadConfig({ ...base, REQUEST_LOG_DB: 'true' })).toThrow(/DATABASE_URL/);
  });
  it('etkinleştirilir ve saklama süresi okunur', () => {
    const c = loadConfig({ ...base, REQUEST_LOG_DB: 'true', DATABASE_URL: 'postgres://a:b@db/x', LOG_RETENTION_DAYS: '14' });
    expect(c.requestLog).toEqual({ enabled: true, databaseUrl: 'postgres://a:b@db/x', retentionDays: 14 });
  });
  it('geçersiz saklama süresi reddedilir', () => {
    expect(() => loadConfig({ ...base, LOG_RETENTION_DAYS: '0' })).toThrow(/LOG_RETENTION_DAYS/);
  });
});
