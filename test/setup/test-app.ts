import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { runSeed } from '../../src/database/seeds/seed';
import { API_PREFIX, configureApp } from '../../src/main';
import { ApiUsageLogService } from '../../src/modules/logging/api-usage-log.service';

export interface TestContext {
  app: NestExpressApplication;
  dataSource: DataSource;
  /** supertest agent bound to the app */
  http: () => ReturnType<typeof request>;
  /** prefixes a route with /api/v1 */
  api: (path: string) => string;
  /** waits for request-log rows still being written */
  flushLogs: () => Promise<void>;
  close: () => Promise<void>;
}

const TABLES = [
  'api_usage_logs',
  'web_searches',
  'chat_messages',
  'conversations',
  'sessions',
  'subscriptions',
  'users',
  'ai_providers',
  'roles',
];

/** Empties every table and re-seeds roles, demo users and providers. */
export async function resetDatabase(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  await runSeed(dataSource);
}

/**
 * Boots the real AppModule (same setup as main.ts) against the test DB,
 * migrated and freshly seeded.
 */
export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
  });
  configureApp(app);
  await app.init();

  const dataSource = app.get(DataSource);
  await dataSource.runMigrations();
  await resetDatabase(dataSource);

  const usageLogs = app.get(ApiUsageLogService);
  return {
    app,
    dataSource,
    http: () => request(app.getHttpServer()),
    api: (path: string) => `/${API_PREFIX}${path}`,
    flushLogs: () => usageLogs.flush(),
    close: () => app.close(),
  };
}
