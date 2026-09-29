import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

/**
 * Runs before every e2e test file: points the app at the test database
 * (never the dev one) and lifts rate limits so tests can log in freely.
 */
loadEnv({ path: resolve(__dirname, '../../.env') });

function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('DATABASE_URL is not set (see .env.example)');
  }
  const url = new URL(base);
  url.pathname = '/echogpt_test';
  return url.toString();
}

const url = testDatabaseUrl();
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) {
  throw new Error('e2e tests only run against a database ending in _test');
}

process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.LOGIN_RATE_LIMIT_PER_MINUTE = '100000';
