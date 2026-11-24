-- address-services şeması (idempotent: tekrar çalıştırmak güvenlidir)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Her tablo: hızlı liste/arama için düz kolonlar (bbox, merkez nokta, arama anahtarı)
-- + sınır geometrisi (SRID 4326 = WGS84, boylam/enlem).
-- bbox ve merkez, içe aktarma sırasında uygulama tarafından hesaplanır; böylece
-- liste sorguları büyük geometri kolonunu hiç okumak zorunda kalmaz.

CREATE TABLE IF NOT EXISTS provinces (
  id            integer PRIMARY KEY,
  name          text NOT NULL,
  population    integer NOT NULL,
  search_key    text NOT NULL,
  min_lng       double precision NOT NULL,
  min_lat       double precision NOT NULL,
  max_lng       double precision NOT NULL,
  max_lat       double precision NOT NULL,
  centroid_lng  double precision NOT NULL,
  centroid_lat  double precision NOT NULL,
  geom          geometry(Geometry, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS districts (
  id            integer PRIMARY KEY,
  province_id   integer NOT NULL REFERENCES provinces (id),
  name          text NOT NULL,
  type          text NOT NULL,
  population    integer NOT NULL,
  search_key    text NOT NULL,
  min_lng       double precision NOT NULL,
  min_lat       double precision NOT NULL,
  max_lng       double precision NOT NULL,
  max_lat       double precision NOT NULL,
  centroid_lng  double precision NOT NULL,
  centroid_lat  double precision NOT NULL,
  geom          geometry(Geometry, 4326) NOT NULL
);

CREATE TABLE IF NOT EXISTS neighborhoods (
  id            integer PRIMARY KEY,
  district_id   integer NOT NULL REFERENCES districts (id),
  name          text NOT NULL,
  type          text NOT NULL,
  type_key      text NOT NULL,
  type_code     integer NOT NULL,
  population    integer NOT NULL,
  search_key    text NOT NULL,
  min_lng       double precision NOT NULL,
  min_lat       double precision NOT NULL,
  max_lng       double precision NOT NULL,
  max_lat       double precision NOT NULL,
  centroid_lng  double precision NOT NULL,
  centroid_lat  double precision NOT NULL,
  geom          geometry(Geometry, 4326) NOT NULL
);

-- Mekansal indeksler (reverse geocoding / ST_Intersects için kritik)
CREATE INDEX IF NOT EXISTS provinces_geom_gix      ON provinces      USING gist (geom);
CREATE INDEX IF NOT EXISTS districts_geom_gix      ON districts      USING gist (geom);
CREATE INDEX IF NOT EXISTS neighborhoods_geom_gix  ON neighborhoods  USING gist (geom);

-- İlişki ve filtre indeksleri
CREATE INDEX IF NOT EXISTS districts_province_idx     ON districts (province_id);
CREATE INDEX IF NOT EXISTS neighborhoods_district_idx ON neighborhoods (district_id);

-- İsim araması (LIKE '%...%') için trigram indeksleri
CREATE INDEX IF NOT EXISTS provinces_search_trgm      ON provinces     USING gin (search_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS districts_search_trgm      ON districts     USING gin (search_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS neighborhoods_search_trgm  ON neighborhoods USING gin (search_key gin_trgm_ops);

-- Üst kayıt adlarını birleştiren görünümler (repository sorguları bunları okur)
CREATE OR REPLACE VIEW v_districts AS
SELECT d.id, d.province_id, p.name AS province_name, d.name, d.type, d.population, d.search_key,
       d.min_lng, d.min_lat, d.max_lng, d.max_lat, d.centroid_lng, d.centroid_lat
FROM districts d
JOIN provinces p ON p.id = d.province_id;

CREATE OR REPLACE VIEW v_neighborhoods AS
SELECT n.id, n.district_id, d.name AS district_name, d.province_id, p.name AS province_name,
       n.name, n.type, n.type_key, n.type_code, n.population, n.search_key,
       n.min_lng, n.min_lat, n.max_lng, n.max_lat, n.centroid_lng, n.centroid_lat
FROM neighborhoods n
JOIN districts d ON d.id = n.district_id
JOIN provinces p ON p.id = d.province_id;

-- Yüklenen veri kümesinin sürümü (ETag için) ve kaynakları
CREATE TABLE IF NOT EXISTS dataset_meta (
  id          integer PRIMARY KEY CHECK (id = 1),
  version     text NOT NULL,
  sources     text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

