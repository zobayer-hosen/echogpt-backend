import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Name of the bearer scheme used by `@ApiBearerAuth(BEARER_AUTH)`. */
export const BEARER_AUTH = 'access-token';

export const SWAGGER_PATH = 'api/docs';

const TAGS: [string, string][] = [
  ['Health', 'Public liveness check'],
  ['Auth', 'Register, login, token refresh, logout, email verification'],
  ['Users', 'Your own profile, password and account'],
  ['Plans', 'Free and Premium plans'],
  ['Subscriptions', 'Your plan, plan changes and daily usage'],
  ['Providers', 'AI providers you can use'],
  ['Chat', 'Conversations and messages with AI providers'],
  ['Search', 'AI-assisted web search, history and suggestions'],
  ['Admin · Dashboard', 'Headline numbers for the admin panel'],
  ['Admin · Users', 'Manage users, roles and status'],
  ['Admin · Subscriptions', 'Manage user plans and usage'],
  ['Admin · Providers', 'Manage AI providers, keys, default and health'],
  ['Admin · Analytics', 'AI usage analytics'],
  ['Admin · Logs', 'HTTP request logs'],
  ['Admin · Health', 'System health'],
];

export function setupSwagger(app: INestApplication): void {
  const builder = new DocumentBuilder()
    .setTitle('EchoGPT API')
    .setDescription(
      [
        'REST API for the EchoGPT multi-AI Chrome extension.',
        '',
        '**Auth:** call `POST /auth/login`, then click **Authorize** and paste the `accessToken`.',
        'Access tokens live 15 minutes; use `POST /auth/refresh` with the refresh token to rotate.',
        '',
        '**Errors** always have the shape `{ statusCode, code, message, details?, timestamp, path, requestId }`.',
        '',
        '**Lists** accept `?page=1&limit=20` (max 100) and return `{ data, meta: { page, limit, total, totalPages } }`.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Access token from /auth/login, /auth/register or /auth/refresh',
      },
      BEARER_AUTH,
    );
  for (const [name, description] of TAGS) {
    builder.addTag(name, description);
  }

  const document = SwaggerModule.createDocument(app, builder.build());
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: 'api/docs-json',
    customSiteTitle: 'EchoGPT API docs',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      tagsSorter: 'alpha',
    },
  });
}
