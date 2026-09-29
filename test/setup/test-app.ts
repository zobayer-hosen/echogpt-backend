import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { API_PREFIX, configureApp } from '../../src/main';

export interface TestContext {
  app: NestExpressApplication;
  dataSource: DataSource;
  /** supertest agent bound to the app */
  http: () => ReturnType<typeof request>;
  /** prefixes a route with /api/v1 */
  api: (path: string) => string;
  close: () => Promise<void>;
}

/** Boots the real AppModule (same setup as main.ts) against the test DB. */
export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
  });
  configureApp(app);
  await app.init();

  return {
    app,
    dataSource: app.get(DataSource),
    http: () => request(app.getHttpServer()),
    api: (path: string) => `/${API_PREFIX}${path}`,
    close: () => app.close(),
  };
}
