import { validateEnv } from './env.validation';

/** Converts `15m`, `1h`, `7d` or `30s` to seconds. */
export function durationToSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }
  const units = { s: 1, m: 60, h: 3600, d: 86400 } as const;
  return Number(match[1]) * units[match[2] as keyof typeof units];
}

export interface AppConfig {
  app: {
    env: 'development' | 'production' | 'test';
    port: number;
    corsOrigins: string[];
  };
  db: { url: string };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  };
  crypto: { encryptionKey: string };
  plans: { freeDailyLimit: number; premiumDailyLimit: number };
  ai: { requestTimeoutMs: number };
  search: { cacheTtlSeconds: number };
  throttle: { perMinute: number; loginPerMinute: number };
}

export function buildConfig(env: Record<string, unknown>): AppConfig {
  const e = validateEnv(env);
  return {
    app: {
      env: e.NODE_ENV,
      port: e.PORT,
      corsOrigins: e.CORS_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    },
    db: { url: e.DATABASE_URL },
    jwt: {
      accessSecret: e.JWT_ACCESS_SECRET,
      refreshSecret: e.JWT_REFRESH_SECRET,
      accessTtlSeconds: durationToSeconds(e.JWT_ACCESS_TTL),
      refreshTtlSeconds: durationToSeconds(e.JWT_REFRESH_TTL),
    },
    crypto: { encryptionKey: e.ENCRYPTION_KEY },
    plans: {
      freeDailyLimit: e.FREE_DAILY_LIMIT,
      premiumDailyLimit: e.PREMIUM_DAILY_LIMIT,
    },
    ai: { requestTimeoutMs: e.AI_REQUEST_TIMEOUT_MS },
    search: { cacheTtlSeconds: e.SEARCH_CACHE_TTL_SECONDS },
    throttle: {
      perMinute: e.RATE_LIMIT_PER_MINUTE,
      loginPerMinute: e.LOGIN_RATE_LIMIT_PER_MINUTE,
    },
  };
}

/** Typed config loaded by ConfigModule (`ConfigService<AppConfig, true>`). */
export default (): AppConfig => buildConfig(process.env);
