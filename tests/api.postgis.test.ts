import { describe, it } from 'bun:test';
import { PostgisRepository } from '../src/data/postgis/postgis-repository.ts';
import { defineApiTests } from './api.suite.ts';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const url = process.env['TEST_DATABASE_URL'];

/**
 * Yalnızca TEST_DATABASE_URL tanımlıysa çalışır. Veritabanı önceden Adana verisiyle doldurulmuş olmalı:
 *   docker compose up -d db
 *   DATABASE_URL=postgres://address:SIFRE@localhost:5433/address bun run import:postgis -- --reset
 *   TEST_DATABASE_URL=postgres://address:SIFRE@localhost:5433/address bun test tests/api.postgis.test.ts
 */
if (url) {
  defineApiTests('API (postgis sürücüsü)', () => new PostgisRepository({ url, poolMax: 2 }, silent));
} else {
  describe('API (postgis sürücüsü)', () => {
    it.skip('TEST_DATABASE_URL tanımlı değil, atlandı', () => {});
  });
}
