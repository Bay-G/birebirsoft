import type { Logger } from './logger.ts';

/** Veritabanına yazılacak tek bir istek kaydı. */
export interface RequestLogRecord {
  createdAt: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  errorCode: string | null;
  /** Yalnızca 5xx: iç hata ayrıntısı (kısaltılmış). */
  errorDetail: string | null;
  /** Doğru API anahtarının geri döndürülemez kısa parmak izi; anahtarın kendisi DEĞİL. */
  apiKeyId: string | null;
  clientIp: string | null;
  queryString: string | null;
  lat: number | null;
  lng: number | null;
}

/** İstek logunun gideceği yer. record() ASLA istek akışını bozmaz/engellemez. */
export interface RequestLogSink {
  record(entry: RequestLogRecord): void;
  close(): Promise<void>;
}

export class NoopRequestLogSink implements RequestLogSink {
  record(): void {}
  async close(): Promise<void> {}
}

export interface BatchOptions {
  /** Bellekte bekleyebilecek en çok kayıt; dolunca en eskiler atılır. */
  maxQueue: number;
  /** Tek INSERT'te yazılacak en çok kayıt. */
  batchSize: number;
  flushIntervalMs: number;
  /** Aynı grup üst üste bu kadar başarısız olursa grup atılır (zehirli kayıt tüm kuyruğu kilitlemesin). */
  maxConsecutiveFailures: number;
}

export const DEFAULT_BATCH_OPTIONS: BatchOptions = {
  maxQueue: 10_000,
  batchSize: 100,
  flushIntervalMs: 2_000,
  maxConsecutiveFailures: 5,
};

/**
 * Kayıtları bellekte biriktirip toplu yazar: istek süresine ek gecikme getirmez,
 * veritabanı geçici kesilirse kayıtlar kuyrukta bekler (üst sınırla), servis çökmez.
 * Her istek ayrıca stdout loguna da yazıldığı için (pino) kuyruktan atılan kayıt tamamen kaybolmaz.
 */
export class BatchedRequestLogSink implements RequestLogSink {
  private queue: RequestLogRecord[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private flushing: Promise<void> | undefined;
  private consecutiveFailures = 0;
  private dropped = 0;
  private readonly opts: BatchOptions;

  constructor(
    private readonly write: (batch: RequestLogRecord[]) => Promise<void>,
    private readonly logger: Logger,
    opts: Partial<BatchOptions> = {},
  ) {
    this.opts = { ...DEFAULT_BATCH_OPTIONS, ...opts };
  }

  start(): void {
    this.timer = setInterval(() => void this.flush(), this.opts.flushIntervalMs);
    this.timer.unref?.();
  }

  record(entry: RequestLogRecord): void {
    this.queue.push(entry);
    if (this.queue.length > this.opts.maxQueue) {
      const overflow = this.queue.length - this.opts.maxQueue;
      this.queue.splice(0, overflow);
      this.dropped += overflow;
    }
    if (this.queue.length >= this.opts.batchSize) void this.flush();
  }

  /** Aynı anda tek flush çalışır; çağıran, süren flush'ı bekler. */
  flush(): Promise<void> {
    if (!this.flushing) {
      this.flushing = this.drain().finally(() => {
        this.flushing = undefined;
      });
    }
    return this.flushing;
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.opts.batchSize);
      try {
        await this.write(batch);
        this.consecutiveFailures = 0;
      } catch (err) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.opts.maxConsecutiveFailures) {
          this.dropped += batch.length;
          this.consecutiveFailures = 0;
          this.logger.error(
            { err, dropped: batch.length },
            'İstek logu veritabanına yazılamadı; grup atıldı (kayıtlar yalnızca stdout logunda)',
          );
        } else {
          // Başa geri koy, bir sonraki tetiklemede (zamanlayıcı) yeniden dene.
          this.queue.unshift(...batch);
          if (this.queue.length > this.opts.maxQueue) {
            const overflow = this.queue.length - this.opts.maxQueue;
            this.queue.splice(0, overflow);
            this.dropped += overflow;
          }
          this.logger.warn(
            { err, queued: this.queue.length, attempt: this.consecutiveFailures },
            'İstek logu yazılamadı; yeniden denenecek',
          );
          return;
        }
      }
    }
  }

  get stats(): { queued: number; dropped: number } {
    return { queued: this.queue.length, dropped: this.dropped };
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    // Kapanışta kuyruğu boşaltmayı birkaç kez dene (kalıcı hata varsa sonsuza dek bekleme).
    for (let i = 0; i < this.opts.maxConsecutiveFailures && this.queue.length > 0; i++) {
      await this.flush();
    }
    if (this.queue.length > 0) {
      this.logger.error({ lost: this.queue.length }, 'Kapanışta yazılamayan istek logları atıldı');
    }
  }
}
