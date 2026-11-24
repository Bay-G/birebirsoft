import pino from 'pino';

/** Data/service katmanlarının ihtiyaç duyduğu en küçük logger arayüzü (pino ile uyumlu). */
export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export function createLogger(level: string): pino.Logger {
  return pino({
    level,
    base: { service: 'address-services' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  });
}
