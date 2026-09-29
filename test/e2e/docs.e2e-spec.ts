import { createTestApp, TestContext } from '../setup/test-app';

interface Operation {
  summary?: string;
  tags?: string[];
  security?: Record<string, string[]>[];
  parameters?: {
    name: string;
    in: string;
    example?: unknown;
    schema?: { example?: unknown };
  }[];
  requestBody?: { content: Record<string, { schema: SchemaRef }> };
  responses: Record<string, { content?: Record<string, unknown> }>;
}
interface SchemaRef {
  $ref?: string;
}
interface Schema {
  properties?: Record<
    string,
    { example?: unknown; $ref?: string; items?: SchemaRef; allOf?: SchemaRef[] }
  >;
}
interface OpenApi {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
}

/** Every endpoint of PRD §6 (bonus ones are added by their branches). */
const PRD_ENDPOINTS = [
  'GET /health',
  'POST /auth/register',
  'POST /auth/login',
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /auth/logout-all',
  'GET /users/me',
  'PATCH /users/me',
  'PATCH /users/me/password',
  'DELETE /users/me',
  'GET /plans',
  'GET /subscriptions/me',
  'POST /subscriptions/me/change',
  'GET /subscriptions/me/usage',
  'GET /providers',
  'POST /chat/messages',
  'POST /chat/conversations',
  'GET /chat/conversations',
  'GET /chat/conversations/{id}',
  'PATCH /chat/conversations/{id}',
  'DELETE /chat/conversations/{id}',
  'POST /chat/conversations/{id}/messages',
  'POST /search',
  'GET /search/history',
  'DELETE /search/history',
  'DELETE /search/history/{id}',
  'GET /search/recent',
  'GET /search/suggestions',
  'GET /admin/dashboard',
  'GET /admin/health',
  'GET /admin/users',
  'GET /admin/users/{id}',
  'PATCH /admin/users/{id}',
  'DELETE /admin/users/{id}',
  'GET /admin/subscriptions',
  'PATCH /admin/subscriptions/{userId}',
  'GET /admin/providers',
  'POST /admin/providers',
  'PATCH /admin/providers/{id}',
  'DELETE /admin/providers/{id}',
  'PATCH /admin/providers/{id}/status',
  'PATCH /admin/providers/{id}/default',
  'POST /admin/providers/{id}/health-check',
  'GET /admin/providers/health',
  'GET /admin/analytics/usage',
  'GET /admin/logs/requests',
];

/** Routes that work without a token (PRD §6 🔓). */
const PUBLIC = new Set([
  'GET /api/v1/health',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/verify-email',
  'GET /api/v1/plans',
]);

describe('Swagger / OpenAPI completeness (e2e)', () => {
  let t: TestContext;
  let doc: OpenApi;
  const operations: [string, Operation][] = [];

  beforeAll(async () => {
    t = await createTestApp();
    doc = (await t.http().get('/api/docs-json').expect(200)).body;
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        operations.push([`${method.toUpperCase()} ${path}`, op]);
      }
    }
  });

  afterAll(async () => {
    await t.close();
  });

  it('documents every PRD §6 endpoint', () => {
    const documented = new Set(
      operations.map(([name]) => name.replace(' /api/v1', ' ')),
    );
    const missing = PRD_ENDPOINTS.filter((e) => !documented.has(e));
    expect(missing).toEqual([]);
  });

  it('every operation has a summary and a tag', () => {
    const missing = operations
      .filter(([, op]) => !op.summary || !op.tags?.length)
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it('every protected operation shows the lock; public ones do not', () => {
    const wrong = operations
      .filter(([name, op]) => PUBLIC.has(name) === Boolean(op.security?.length))
      .map(([name]) => name);
    expect(wrong).toEqual([]);
  });

  it('every operation documents a success response and its errors', () => {
    const problems: string[] = [];
    for (const [name, op] of operations) {
      const codes = Object.keys(op.responses);
      if (!codes.some((c) => c.startsWith('2'))) {
        problems.push(`${name}: no 2xx`);
      }
      for (const required of ['429', '500']) {
        if (!codes.includes(required)) {
          problems.push(`${name}: no ${required}`);
        }
      }
      if (!PUBLIC.has(name) && !codes.includes('401')) {
        problems.push(`${name}: no 401`);
      }
      if (name.includes('/admin/') && !codes.includes('403')) {
        problems.push(`${name}: no 403`);
      }
      if (op.requestBody && !codes.includes('400')) {
        problems.push(`${name}: body but no 400`);
      }
      if (/\{\w+\}/.test(name) && !codes.includes('404')) {
        problems.push(`${name}: path param but no 404`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every path parameter has an example', () => {
    const missing = operations.flatMap(([name, op]) =>
      (op.parameters ?? [])
        .filter(
          (p) =>
            p.in === 'path' &&
            p.example === undefined &&
            p.schema?.example === undefined,
        )
        .map((p) => `${name} :${p.name}`),
    );
    expect(missing).toEqual([]);
  });

  it('every schema property has an example (bodies and responses)', () => {
    const missing: string[] = [];
    for (const [schemaName, schema] of Object.entries(doc.components.schemas)) {
      for (const [prop, def] of Object.entries(schema.properties ?? {})) {
        const nested = def.$ref || def.items?.$ref || def.allOf?.length;
        if (def.example === undefined && !nested) {
          missing.push(`${schemaName}.${prop}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('never documents secret fields', () => {
    const text = JSON.stringify(doc.components.schemas);
    expect(text).not.toMatch(/passwordHash|refreshTokenHash|apiKeyEncrypted/);
  });
});
