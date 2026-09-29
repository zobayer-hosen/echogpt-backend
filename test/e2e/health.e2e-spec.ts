import { createTestApp, TestContext } from '../setup/test-app';

describe('Health, errors and docs (e2e)', () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('GET /health returns only the status and a request id', async () => {
    const res = await t.http().get(t.api('/health')).expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[\w.-]+$/);
  });

  it('reuses a safe client x-request-id', async () => {
    const res = await t
      .http()
      .get(t.api('/health'))
      .set('x-request-id', 'client-abc-123')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('client-abc-123');
  });

  it('replaces an unsafe client x-request-id', async () => {
    const res = await t
      .http()
      .get(t.api('/health'))
      .set('x-request-id', 'bad id <script>')
      .expect(200);
    expect(res.headers['x-request-id']).not.toContain('<');
  });

  it('unknown routes use the shared error shape', async () => {
    const res = await t.http().get(t.api('/nope')).expect(404);
    expect(res.body).toEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: expect.any(String),
      timestamp: expect.any(String),
      path: '/api/v1/nope',
      requestId: res.headers['x-request-id'],
    });
    expect(res.body.stack).toBeUndefined();
  });

  it('malformed JSON is a 400 VALIDATION_ERROR', async () => {
    const res = await t
      .http()
      .post(t.api('/health'))
      .set('content-type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.requestId).toEqual(expect.any(String));
  });

  it('serves the OpenAPI document', async () => {
    const res = await t.http().get('/api/docs-json').expect(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.paths['/api/v1/health']).toBeDefined();
  });
});
