-- İstek logları (her API isteği için bir satır). Idempotent: tekrar çalıştırmak güvenlidir.
-- Gizli bilgi YOK: API anahtarının kendisi saklanmaz (yalnızca geri döndürülemez kısa parmak izi).
-- DİKKAT: client_ip, query_string, lat, lng kişisel veri sayılabilir; saklama süresi (LOG_RETENTION_DAYS)
-- ve erişim yetkisi buna göre ayarlanmalıdır.
CREATE TABLE IF NOT EXISTS request_logs (
  id           bigserial PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  request_id   text NOT NULL,
  method       text NOT NULL,
  path         text NOT NULL,
  status_code  integer NOT NULL,
  duration_ms  double precision NOT NULL,
  error_code   text,
  error_detail text,
  api_key   text,
  client_ip    text,
  query_string text,
  lat          double precision,
  lng          double precision
);

-- Tablo bu kolonlar eklenmeden ÖNCE oluşturulduysa eksik kolonlar eklenir (mevcut satırlar korunur).
ALTER TABLE request_logs
  ADD COLUMN IF NOT EXISTS client_ip    text,
  ADD COLUMN IF NOT EXISTS query_string text,
  ADD COLUMN IF NOT EXISTS lat          double precision,
  ADD COLUMN IF NOT EXISTS lng          double precision;

CREATE INDEX IF NOT EXISTS request_logs_created_at_idx  ON request_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS request_logs_status_idx      ON request_logs (status_code, created_at DESC);
CREATE INDEX IF NOT EXISTS request_logs_request_id_idx  ON request_logs (request_id);
CREATE INDEX IF NOT EXISTS request_logs_path_status_idx ON request_logs (path, status_code, created_at DESC);

COMMENT ON TABLE  request_logs              IS 'API istek logları (saklama süresi LOG_RETENTION_DAYS ile sınırlıdır)';
COMMENT ON COLUMN request_logs.error_code   IS 'Hata varsa uygulama hata kodu (UNAUTHORIZED, NOT_FOUND, VALIDATION_ERROR...)';
COMMENT ON COLUMN request_logs.error_detail IS 'Yalnızca 5xx: iç hata ayrıntısı (kısaltılmış). İstemciye ASLA gönderilmez.';
COMMENT ON COLUMN request_logs.api_key   IS 'Doğru anahtarın SHA-256 özetinin ilk 8 karakteri; anahtarı ifşa etmez';
COMMENT ON COLUMN request_logs.client_ip    IS 'İstemci IP adresi (TRUST_PROXY=true ise X-Forwarded-For; Docker/localhost testlerinde Docker ağ geçidi görünebilir)';
COMMENT ON COLUMN request_logs.query_string IS 'Ham sorgu metni, örn. lat=abc&lng=35.3 (geçersiz değerler olduğu gibi görünür)';
COMMENT ON COLUMN request_logs.lat          IS 'lat parametresi sayı olarak okunabildiyse; okunamadıysa NULL (ham değer query_string içinde)';
COMMENT ON COLUMN request_logs.lng          IS 'lng parametresi sayı olarak okunabildiyse; okunamadıysa NULL (ham değer query_string içinde)';