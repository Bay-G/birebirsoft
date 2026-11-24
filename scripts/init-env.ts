/**
 * .env dosyasını .env.example'dan üretir; "change_me" değerlerini rastgele şifre/anahtarla değiştirir.
 * Var olan .env dosyasını ASLA ezmez.
 * Kullanım: bun run init:env
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = new URL('../.env', import.meta.url);
const example = new URL('../.env.example', import.meta.url);

if (existsSync(target)) {
  console.log('.env zaten var; değiştirilmedi.');
  process.exit(0);
}

// hex: URL ve .env içinde güvenli karakterler (harf+rakam)
const dbPassword = randomBytes(16).toString('hex');
const apiKey = randomBytes(24).toString('hex');

const text = readFileSync(example, 'utf8')
  .replaceAll('change_me_db_password', dbPassword)
  .replaceAll('change_me_api_key_0123456789abcdef', apiKey);

writeFileSync(target, text, { mode: 0o600 });
console.log('.env oluşturuldu.');
console.log(`  API anahtarınız (x-api-key): ${apiKey}`);
console.log('  Şifreler .env dosyasındadır; bu dosyayı paylaşmayın / repoya eklemeyin.');
