/**
 * Uygulama genelinde kullanılan hata tipleri.
 * Controller/service katmanı bu hataları fırlatır; HTTP'ye çevirme işi
 * yalnızca merkezi error-handler plugin'inde yapılır.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string | number) {
    super(404, 'NOT_FOUND', `${resource} bulunamadı: ${id}`);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Geçerli bir API anahtarı gerekli') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Servis henüz hazır değil') {
    super(503, 'SERVICE_UNAVAILABLE', message);
  }
}

/** Başlangıçta env doğrulaması başarısız olduğunda fırlatılır (HTTP'ye çıkmaz). */
export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Geçersiz yapılandırma:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/** GeoJSON dosyası beklenen şemaya/ilişkilere uymadığında fırlatılır (başlangıçta fail-fast). */
export class DataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataIntegrityError';
  }
}
