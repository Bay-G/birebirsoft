import { loadConfig } from '../src/config/env.ts';
import { GeoJsonRepository } from '../src/data/geojson/geojson-repository.ts';
import { defineApiTests } from './api.suite.ts';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

// Bellek içi (GeoJSON dosyaları) sürücü
defineApiTests('API (geojson sürücüsü)', () => {
  const config = loadConfig({ NODE_ENV: 'test', API_KEYS: 'test-key-0123456789-abcdefgh', LOG_LEVEL: 'silent' });
  return new GeoJsonRepository(config.data, silent);
});
