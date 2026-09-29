import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const DURATION = /^\d+[smhd]$/;
const POSTGRES_URL = /^postgres(ql)?:\/\/.+/;

export class EnvironmentVariables {
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: 'development' | 'production' | 'test' = 'development';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @Matches(POSTGRES_URL, {
    message: 'DATABASE_URL must be a postgresql:// URL',
  })
  DATABASE_URL: string;

  @IsOptional()
  @Matches(POSTGRES_URL, {
    message: 'TEST_DATABASE_URL must be a postgresql:// URL',
  })
  TEST_DATABASE_URL?: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET: string;

  @Matches(DURATION, { message: 'JWT_ACCESS_TTL must look like 15m, 1h or 7d' })
  JWT_ACCESS_TTL: string = '15m';

  @Matches(DURATION, {
    message: 'JWT_REFRESH_TTL must look like 15m, 1h or 7d',
  })
  JWT_REFRESH_TTL: string = '7d';

  @Matches(/^[0-9a-fA-F]{64}$/, {
    message: 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)',
  })
  ENCRYPTION_KEY: string;

  @IsInt()
  @Min(1)
  FREE_DAILY_LIMIT: number = 20;

  @IsInt()
  @Min(1)
  PREMIUM_DAILY_LIMIT: number = 500;

  @IsString()
  CORS_ORIGINS: string = 'http://localhost:3000';

  @IsInt()
  @Min(0)
  SEARCH_CACHE_TTL_SECONDS: number = 3600;

  @IsInt()
  @Min(1000)
  AI_REQUEST_TIMEOUT_MS: number = 30000;

  @IsInt()
  @Min(1)
  RATE_LIMIT_PER_MINUTE: number = 60;

  @IsInt()
  @Min(1)
  LOGIN_RATE_LIMIT_PER_MINUTE: number = 5;
}

/**
 * Validates process env at startup. Error messages name the variable and the
 * rule, never its value, so secrets are not printed.
 */
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
    excludeExtraneousValues: false,
  });
  const errors = validateSync(env, { skipMissingProperties: false });
  const problems = errors.map(
    (e) =>
      `${e.property}: ${Object.values(e.constraints ?? {}).join(', ') || 'invalid'}`,
  );
  if (
    env.JWT_ACCESS_SECRET &&
    env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET
  ) {
    problems.push('JWT_REFRESH_SECRET: must differ from JWT_ACCESS_SECRET');
  }
  if (problems.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  - ${problems.join('\n  - ')}`,
    );
  }
  return env;
}
