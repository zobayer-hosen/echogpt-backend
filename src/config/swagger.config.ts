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
        'REST API for the EchoGPT multi-AI Chrome extension: chat with several AI providers, AI-assisted web search, Free/Premium plans with daily limits, and admin APIs.',
        '',
        '### Quick start',
        '1. `POST /auth/login` with a demo account (password `Password123!`, demo only):',
        '   `alice@echogpt.dev` (FREE, 20 requests/day) · `bob@echogpt.dev` (PREMIUM, 500/day) · `admin@echogpt.dev` (ADMIN)',
        '2. Click **Authorize** and paste the `accessToken`.',
        '3. `POST /chat/messages` with `{ "prompt": "Hello" }`. The seeded **Mock AI** provider answers for free; admins can add OpenAI, Anthropic or Gemini keys.',
        '',
        '### Conventions',
        '- **Tokens:** access 15 min, refresh 7 days. `POST /auth/refresh` rotates both; an old refresh token revokes the session.',
        '- **Errors:** `{ statusCode, code, message, details?, timestamp, path, requestId }`. Every response has an `x-request-id` header.',
        '- **Lists:** `?page=1&limit=20` (max 100) → `{ data, meta: { page, limit, total, totalPages } }`.',
        '- **Usage:** each chat message and search counts 1 request per UTC day; a failed AI call does not count.',
        '- **Rate limits:** 60 requests/min per IP, 5 logins/min per IP → `429 RATE_LIMITED`.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .setExternalDoc(
      'README and design docs',
      'https://github.com/zobayer-hosen/echogpt-backend',
    )
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
