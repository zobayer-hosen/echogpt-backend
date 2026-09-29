import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppException } from './common/exceptions/app.exception';
import { AppConfig } from './config/configuration';
import { SWAGGER_PATH, setupSwagger } from './config/swagger.config';

export const API_PREFIX = 'api/v1';

/** Shared by bootstrap() and the e2e tests so both run the same app. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService<AppConfig, true>);

  app.setGlobalPrefix(API_PREFIX);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Swagger UI needs inline styles and data: images
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          // local dev runs on plain http
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
  app.enableCors({
    origin: config.get('app.corsOrigins', { infer: true }),
    exposedHeaders: ['x-request-id'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => AppException.fromValidationErrors(errors),
    }),
  );
  setupSwagger(app);
  app.enableShutdownHooks();
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  const port = app.get(ConfigService<AppConfig, true>).get('app.port', {
    infer: true,
  });
  await app.listen(port);
  const logger = new Logger('Bootstrap');
  logger.log(`EchoGPT API listening on http://localhost:${port}/${API_PREFIX}`);
  logger.log(`Swagger UI at http://localhost:${port}/${SWAGGER_PATH}`);
}

if (require.main === module) {
  void bootstrap();
}
