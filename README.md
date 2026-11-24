# address-services

Türkiye'nin il / ilçe / mahalle verisini (isim, nüfus, sınır geometrisi) API key ile sunan bağımsız servis.
Stack: **Bun · TypeScript · Elysia · Swagger/OpenAPI · Docker**

> **Not:** `geocode-services` örnek projesi bana iletilmedi. API key header'ı (`x-api-key`), env isimleri,
> hata gövdesi ve logger formatı **varsayımdır**; şirket standardına göre `src/plugins/*` ve `src/config/env.ts` içinde
> tek noktadan değiştirilebilir.

## Çalıştırma

```bash
cp .env.example .env          # API_KEYS değerini değiştirin
bun install
bun run dev                   # http://localhost:3000/swagger
bun test
```

```bash
docker compose up --build     # API_KEYS ortam değişkeni zorunlu
curl -H "x-api-key: $API_KEYS" http://localhost:3000/v1/provinces
```

## 1. Veri analizi (verilen dosyalar)

| Dosya | Boyut | Feature | Geometri | Koordinat | Property alanları |
|---|---|---|---|---|---|
| `il.geojson` | 154 KB | 1 | Polygon | 5.969 | `IDARIID, ILADI, USTIDARIID, NUFUS` |
| `ilce.geojson` | 287 KB | 15 | Polygon | 11.021 | `IDARIID, USTIDARIID, ILADI, ILCEADI, TIP, NUFUS` |
| `mahalle.geojson` | 1,5 MB | 831 | Polygon | 48.490 | `ADI, IDARIID, USTIDARIID, ILADI, ILCEADI, BUCAKADI, KOYADI, TIPKOD, TIP, NUFUS` |

Bulgular:

- Üç dosya da `FeatureCollection`, CRS84 (**boylam, enlem** sırası). Tüm geometriler `Polygon`; `MultiPolygon` yok
  (servis yine de ikisini de destekler). Hiçbir property `null` değil.
- **Veri yalnızca Adana'yı kapsıyor** (1 il, 15 ilçe, 831 mahalle). Dosya adı/`name` alanı `01_Adana...` şeklinde.
- Sayısal alanlar float gelir (`1.0`); servis bunları tam sayıya çevirir (`IDARIID`, `NUFUS`, `TIPKOD`).
- Hiyerarşi `USTIDARIID` ile kurulur: mahalle → ilçe → il. Yetim kayıt yok, ID'ler benzersiz.
- `TIP`: ilçede `İlçe` (11) / `Büyükşehir İlçesi` (4); mahallede `Kırsal Mahalle` (551), `Mahalle` (278), `Ada` (1), `OSB` (1).
  `TIPKOD`: 7 = Mahalle/OSB, 8 = Kırsal Mahalle, 9 = Ada.
- `BUCAKADI` ve `KOYADI` 831 kaydın tamamında `"Merkez"`; bu veri setinde bilgi taşımıyor, API'ye açılmadı.
- Mahalle `ADI` değeri `"Olucak Mh."` gibi kısaltmalı geliyor; olduğu gibi korundu.
- **Veri kalitesi:** Sarıçam ilçe nüfusu 150.425, mahalle toplamı 150.423 (fark 2). Başlangıçta `warn` olarak loglanır, hata sayılmaz.
- Bir mahalle (`Sevgi Adası`, tip `Ada`) nüfusu 0.

## Veri klasörü düzeni

`DATA_DIR` (varsayılan `./data`) içinde iki düzen desteklenir ve **birlikte de** kullanılabilir:

```
data/
  il.geojson  ilce.geojson  mahalle.geojson      # tek küme (kök)
  1/   il.geojson  ilce.geojson  mahalle.geojson # her alt klasör bağımsız bir küme
  2/   ...
  70/  ...
```

- Dosya adları `PROVINCE_FILE`, `DISTRICT_FILE`, `NEIGHBORHOOD_FILE` env'leriyle değiştirilebilir (`.json` kullanıyorsanız oradan).
- Alt klasörler doğal sırayla (1, 2, 10, 70) ve **sırayla** yüklenir; aynı anda yalnızca bir kümenin ham verisi bellekte durur.
- Her küme kendi içinde bütün olmalı: ilçelerin üst ili ve mahallelerin üst ilçesi aynı klasördeki (veya daha önce yüklenen) dosyalarda bulunmalı.
- Hiç veri dosyası içermeyen klasör atlanır (uyarı loglanır). Bir klasörde dosyaların **yalnızca bir kısmı** varsa servis açılmaz.
- Aynı `IDARIID` iki kümede geçerse servis açılmaz (`1/il: yinelenen IDARIID 1`). Aynı ili hem kökte hem klasörde tutmayın.
- Yüklenen kümeler `/v1/meta` içinde `sources` alanında görünür.

## 2. Mimari

```
src/
  config/env.ts          env okuma + doğrulama (tüm hatalar tek seferde)
  core/                  hata sınıfları, logger (pino)
  domain/types.ts        Province / District / Neighborhood ...
  data/
    geo-repository.ts    GeoRepository ARAYÜZÜ (service katmanı yalnızca buna bağımlı)
    geojson/             bellek içi implementasyon (loader, geometri, Türkçe normalizasyon)
    postgis/             PostgreSQL/PostGIS implementasyonu
  db/schema.sql          tablolar, GiST/trigram indeksleri, görünümler
  scripts/import-postgis.ts   GeoJSON -> PostGIS içe aktarma
  modules/<kaynak>/      controller (HTTP) + service (iş kuralı) — repository'yi bilmeyen HTTP, HTTP'yi bilmeyen service
  plugins/               api-key-auth, error-handler, request-logger, geojson-response (ETag/gzip)
  app.ts                 kompozisyon kökü (bağımlılıkları bağlar)
  index.ts               başlangıç: config → veri yükle → listen → graceful shutdown
```

- **Hatalar** `AppError` türevleri olarak fırlatılır; tek yerde (`error-handler`) `{ error: { code, message, details? }, requestId }`
  gövdesine çevrilir. 400 doğrulama, 401 key, 404 kayıt/route, 500 beklenmeyen (detay sızdırılmaz, loglanır), 503 hazır değil.
- **Doğrulama** Elysia/TypeBox şemalarıyla (params, query); aynı şemalar Swagger'ı da üretir.
- **Auth** `API_KEYS` (virgüllü liste) — özetler üzerinden zamanlama-güvenli karşılaştırma. `/health*` ve Swagger public.
- Hard-code yok: port, key, veri yolları, cache süreleri, swagger yolu hep env'den (`.env.example`).

## 3. Performans ve bellek analizi

**Karar:** dosyalar uygulama açılışında **bir kez** okunur; HTTP isteği hiçbir zaman diske dokunmaz ve JSON parse etmez.

| Teknik | Neden |
|---|---|
| Başlangıçta yükleme + fail-fast doğrulama | Bozuk veri ile servis ayağa kalkmaz; `/health/ready` yükleme bitince 200 |
| Metadata ve geometri ayrı tutulur | Liste/arama/filtre küçük nesneler üzerinde çalışır; geometri yalnızca istenince okunur |
| Geometri, parse edilmiş nesne yerine **kompakt JSON string** olarak saklanır | Milyonlarca küçük `number[]` yerine tek string: bellekte çok daha az yer tutar ve response'a **yeniden serileştirmeden** yazılır |
| `parentId → children` Map'leri, ID Map'leri | Filtreler O(1)/O(çocuk sayısı) |
| ETag (veri sürümü) + `Cache-Control` + 304 | Veri değişmez; istemci aynı geometriyi tekrar indirmez |
| gzip + bayt bütçeli bellek içi cache | Koordinat JSON'u çok iyi sıkışır; aynı istek için sıkıştırma tekrarlanmaz |
| Mahalle FeatureCollection için il/ilçe filtresi **zorunlu** | Tek istekte tüm ülke geometrisinin dönmesini engeller |
| `locate`: bbox ön elemesi + yalnızca aday geometriyi parse | Koordinatlar bellekte nesne olarak tutulmadan nokta sorgusu |

**Adana'da ölçülen (Node 22):** kaynak 1,9 MB → kompakt geometri ≈ 1,45 MB (mahallede kaynağın %72'si; boşluklar atılıyor);
yükleme sonrası heap artışı ≈ 2,3 MB; yükleme ≈ 0,2 sn; `locate` ≈ 0,2 ms; `search` ≈ 0,05 ms.

**Türkiye ölçeği için tahmin (ölçüm DEĞİL — gerçek veriyle `/v1/meta` ve `bun scripts/analyze-data.ts` ile doğrulayın):**
~81 il, ~970 ilçe, ~50 bin mahalle varsayımıyla Adana oranlarından doğrusal çıkarım: ham veri yaklaşık **100–200 MB**,
kalıcı bellek (kompakt string) yaklaşık **80–150 MB**. Asıl risk **başlangıç anındaki geçici tepe**: ham buffer + string + parse
edilmiş ağaç aynı anda bellekte olur; bu tepe kalıcı boyutun birkaç katı olabilir. Container limitini buna göre verin
(`docker-compose.yml` içindeki `mem_limit` sadece Adana için yeterli bir başlangıç değeridir).

Tepe sorun olursa sırayla: (1) dosyaları il bazında parçalara bölüp sırayla yüklemek, (2) NDJSON/akış ile feature feature okumak,
(3) geometriyi diskte tutup (mmap/SQLite) yalnızca metadata'yı bellekte bırakmak, (4) PostGIS. Mobil için ileride `?simplify=`
(Douglas-Peucker) ile hafif geometri eklenebilir.

## 4. Docker ve PostgreSQL/PostGIS

İki veri kaynağı vardır ve `REPOSITORY_DRIVER` ile seçilir (service/controller kodu değişmez):

| Sürücü | Veri nerede | Ne zaman |
|---|---|---|
| `geojson` (varsayılan) | Açılışta dosyalardan belleğe yüklenir | Geliştirme, küçük veri |
| `postgis` | PostgreSQL + PostGIS (Docker'da) | Büyük veri (Türkiye), mekansal sorgular |

### Docker ile çalıştırma (tam yığın tek komutla)

```bash
bun run init:env                 # .env üretir (rastgele DB şifresi ve API anahtarı; var olan .env'yi ezmez)
docker compose up -d --build
curl -H "x-api-key: <API_KEYS>" http://localhost:3000/v1/provinces
```

`bun` yoksa: `copy .env.example .env` ve `.env` içindeki `change_me...` değerlerini değiştirin (API anahtarı en az 24 karakter).

Compose üç servis ayağa kaldırır ve **sırayla** başlatır:

| Servis | Görev | Başlama koşulu |
|---|---|---|
| `db` | PostgreSQL 16 + PostGIS. İlk açılışta `db/schema.sql` otomatik uygulanır (eklentiler, tablolar, indeksler) | — |
| `importer` | `data/` altındaki GeoJSON'ları yükler; **veritabanı doluysa atlar**; bitince çıkar | `db` sağlıklı |
| `api` | Servis (`REPOSITORY_DRIVER=postgis`) | `db` sağlıklı **ve** `importer` başarıyla bitti |

- Veritabanı portu yalnızca bu makineye açılır: `127.0.0.1:5433` (DBeaver/psql için). Veriler `pgdata` volume'unda kalıcıdır.
- `data/` imaja **kopyalanmaz**; importer onu volume olarak bağlar (imaj ve build bağlamı Türkiye verisiyle şişmez).
- Veriyi değiştirdiyseniz: `bun run docker:reimport` (tabloları boşaltıp yeniden yükler).
- `docker compose down` veriyi korur; `docker compose down -v` veritabanını da siler.
- Kısayollar: `bun run docker:up`, `docker:down`, `docker:logs`, `docker:reimport`.

### Ortam dosyaları

| Dosya | Amaç |
|---|---|
| `.env.example` | Şablon (repoda durur, gizli bilgi içermez) |
| `.env` | Gerçek değerler (`bun run init:env` üretir, **repoya girmez**). Hem `docker compose` (değişken yerine koyma) hem `bun run dev` bunu okur |

Docker'daki `api` ve `importer` servisleri `.env` dosyasını **içeri almaz**; gereken değerleri `docker-compose.yml`
içindeki `environment:` bölümünden alır (`DATABASE_URL` içindeki sunucu adı Docker ağında `db`dir).
Yerelde `bun run dev` için aynı `.env` içindeki `DATABASE_URL` ise `127.0.0.1:5433` adresini kullanır.

### Yerelde (Bun ile) PostGIS'e bağlanma

```bash
docker compose up -d db
# .env: REPOSITORY_DRIVER=postgis  ve  DATABASE_URL=postgres://address:<DB_PASSWORD>@localhost:5433/address
bun run import:postgis -- --reset
bun run dev
```

### Şema (db/schema.sql)

`provinces`, `districts`, `neighborhoods` tabloları; her birinde bbox, merkez nokta, normalize arama anahtarı ve
`geometry(Geometry, 4326)` kolonu. İndeksler: geometri için **GiST** (reverse geocoding), arama için **pg_trgm GIN**,
ilişkiler için B-tree. `v_districts` / `v_neighborhoods` görünümleri üst kayıt adlarını birleştirir.

### İki sürücünün aynı davrandığını doğrulama

```bash
bun test                                             # geojson sürücüsü
# PostGIS doluyken:
TEST_DATABASE_URL=postgres://address:<DB_PASSWORD>@localhost:5433/address bun test tests/api.postgis.test.ts
```

İki dosya da aynı test paketini (`tests/api.suite.ts`) kullanır.

### Sürücüler arası bilinen farklar

- Sıralama: PostGIS sürümü `search_key, id` ile sıralar (aksanları katlanmış isim); bellek içi sürüm Türkçe locale kullanır. ç/ş/ğ gibi harflerin sırası küçük farklar gösterebilir.
- `locate`: PostGIS `ST_Intersects` kullanır (sınır üzerindeki nokta "içeride" sayılır); bellek içi sürüm ray-casting yapar (sınır noktası belirsiz).
- `/v1/meta` içindeki `geometryBytes`: bellekteki string boyutu yerine diskteki geometri boyutudur.
- Koleksiyon endpoint'leri geometrileri tek sorguda alır (`getGeometryJsonMany`), N+1 sorgu yoktur.

## 5. Endpoint'ler

Swagger UI: `/swagger` (OpenAPI JSON: `/swagger/json`). Header: `x-api-key`.

| Method | Path | Açıklama |
|---|---|---|
| GET | `/health`, `/health/ready` | Probe'lar (public) |
| GET | `/v1/provinces?q=` | İl listesi |
| GET | `/v1/provinces/:id` · `/:id/districts` · `/:id/geometry` | Detay · ilçeleri · sınır (Feature) |
| GET | `/v1/districts?provinceId=&q=` | İlçe listesi |
| GET | `/v1/districts/:id` · `/:id/neighborhoods` · `/:id/geometry` | Detay · mahalleleri (sayfalı) · sınır |
| GET | `/v1/neighborhoods?provinceId=&districtId=&type=&q=&limit=&offset=` | Sayfalı mahalle listesi |
| GET | `/v1/neighborhoods/:id` · `/:id/geometry` | Detay · sınır |
| GET | `/v1/geojson/provinces` · `/districts?provinceId=` · `/neighborhoods?provinceId=\|districtId=` | Toplu FeatureCollection |
| GET | `/v1/search?q=&level=&limit=` | Üç seviyede arama (Türkçe karakter duyarsız) |
| GET | `/v1/locate?lat=&lng=` | Koordinattan mahalle/ilçe/il |
| GET | `/v1/meta` | Veri sürümü, sayılar, bellek |

## 6. Bilinen sınırlar / sonraki adımlar

- Rate limiting ve CORS yok (sunucudan sunucuya/mobil kullanım varsayıldı; gerekirse gateway'de veya plugin ile eklenir).
- `locate` bugün mahalleleri doğrusal bbox taramasıyla eler (~50 bin kayıtta bile sub-ms/ms mertebesi beklenir, ölçülmedi);
  çok yüksek RPS için R-tree (`rbush`) ya da PostGIS GiST.
- Sınırları paylaşan komşu poligonlarda tam sınır noktası, ilk eşleşen mahalleye düşer.
- API key'ler env'de; çoklu tüketici/iptal/kota gerekiyorsa key deposu (DB) ayrı bir adım.
