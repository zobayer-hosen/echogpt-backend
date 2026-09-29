import { buildConfig, durationToSeconds } from './configuration';
import { validateEnv } from './env.validation';

const validEnv = () => ({
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/echogpt',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  ENCRYPTION_KEY: 'f'.repeat(64),
});

describe('validateEnv', () => {
  it('accepts a minimal valid env and applies defaults', () => {
    const env = validateEnv(validEnv());
    expect(env.PORT).toBe(3000);
    expect(env.FREE_DAILY_LIMIT).toBe(20);
    expect(env.PREMIUM_DAILY_LIMIT).toBe(500);
    expect(env.JWT_ACCESS_TTL).toBe('15m');
  });

  it('converts numeric strings', () => {
    const env = validateEnv({ ...validEnv(), PORT: '4000' });
    expect(env.PORT).toBe(4000);
  });

  it('rejects a missing or short ENCRYPTION_KEY without printing it', () => {
    const secret = 'abc123';
    expect(() =>
      validateEnv({ ...validEnv(), ENCRYPTION_KEY: secret }),
    ).toThrow(/ENCRYPTION_KEY/);
    try {
      validateEnv({ ...validEnv(), ENCRYPTION_KEY: secret });
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('rejects missing required values', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects equal JWT secrets', () => {
    const same = 'c'.repeat(40);
    expect(() =>
      validateEnv({
        ...validEnv(),
        JWT_ACCESS_SECRET: same,
        JWT_REFRESH_SECRET: same,
      }),
    ).toThrow(/must differ/);
  });
});

describe('buildConfig', () => {
  it('builds typed config with parsed TTLs and CORS list', () => {
    const config = buildConfig({
      ...validEnv(),
      CORS_ORIGINS: 'http://localhost:3000, chrome-extension://abc',
    });
    expect(config.jwt.accessTtlSeconds).toBe(900);
    expect(config.jwt.refreshTtlSeconds).toBe(604800);
    expect(config.app.corsOrigins).toEqual([
      'http://localhost:3000',
      'chrome-extension://abc',
    ]);
  });

  it('parses durations', () => {
    expect(durationToSeconds('30s')).toBe(30);
    expect(durationToSeconds('2h')).toBe(7200);
    expect(() => durationToSeconds('7 days')).toThrow();
  });
});
