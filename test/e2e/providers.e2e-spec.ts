import { decrypt } from '../../src/common/utils/crypto.util';
import { bearer, DEMO, login } from '../setup/factories';
import { createTestApp, TestContext } from '../setup/test-app';

const KEY = 'sk-e2e-super-secret-9f8e';

describe('AI providers (e2e)', () => {
  let t: TestContext;
  let admin: string;
  let alice: string;
  /** every admin response body, to check none ever contains the key */
  const seen: string[] = [];

  const asAdmin = () => ({
    get: (path: string) =>
      t.http().get(t.api(path)).set(bearer(admin)).then(track),
    post: (path: string, body?: object) =>
      t.http().post(t.api(path)).set(bearer(admin)).send(body).then(track),
    patch: (path: string, body?: object) =>
      t.http().patch(t.api(path)).set(bearer(admin)).send(body).then(track),
    delete: (path: string) =>
      t.http().delete(t.api(path)).set(bearer(admin)).then(track),
  });
  const track = <T extends { text: string }>(res: T): T => {
    seen.push(res.text);
    return res;
  };
  const providerId = async (name: string): Promise<string> =>
    (
      await t.dataSource.query(`SELECT id FROM ai_providers WHERE name = $1`, [
        name,
      ])
    )[0].id;

  beforeAll(async () => {
    t = await createTestApp();
    admin = (await login(t, DEMO.admin)).accessToken;
    alice = (await login(t, DEMO.alice)).accessToken;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    for (const body of seen) {
      expect(body).not.toContain(KEY);
      expect(body).not.toMatch(/apiKeyEncrypted|api_key_encrypted/);
    }
    await t.close();
  });

  it('GET /providers shows users only enabled providers, without key info', async () => {
    const res = await t
      .http()
      .get(t.api('/providers'))
      .set(bearer(alice))
      .expect(200);
    expect(res.body).toEqual([
      {
        id: expect.any(String),
        name: 'Mock AI',
        type: 'MOCK',
        model: 'mock-1',
        isDefault: true,
      },
    ]);
  });

  it('a USER cannot use /admin/providers', async () => {
    await t
      .http()
      .get(t.api('/admin/providers'))
      .set(bearer(alice))
      .expect(403);
  });

  describe('keys (T8)', () => {
    it('encrypts the key at rest and only returns a mask', async () => {
      const res = await asAdmin().post('/admin/providers', {
        name: 'OpenAI Test',
        type: 'OPENAI',
        model: 'gpt-4o-mini',
        apiKey: KEY,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'OpenAI Test',
        isEnabled: true,
        isDefault: false,
        hasApiKey: true,
        apiKeyMasked: '••••9f8e',
        healthStatus: 'UNKNOWN',
      });

      const [row] = await t.dataSource.query(
        `SELECT api_key_encrypted, api_key_last4 FROM ai_providers WHERE id = $1`,
        [res.body.id],
      );
      expect(row.api_key_encrypted).not.toContain(KEY);
      expect(row.api_key_encrypted.split(':')).toHaveLength(3);
      expect(decrypt(row.api_key_encrypted, process.env.ENCRYPTION_KEY!)).toBe(
        KEY,
      );
      expect(row.api_key_last4).toBe('9f8e');
    });

    it('requires a key unless MOCK', async () => {
      const res = await asAdmin().post('/admin/providers', {
        name: 'No Key',
        type: 'ANTHROPIC',
        model: 'claude-haiku-4-5',
      });
      expect(res.status).toBe(400);
      expect(res.body.details.apiKey).toBeDefined();

      const mock = await asAdmin().post('/admin/providers', {
        name: 'Second Mock',
        type: 'MOCK',
        model: 'mock-2',
      });
      expect(mock.status).toBe(201);
      expect(mock.body).toMatchObject({ hasApiKey: false, apiKeyMasked: null });
    });

    it('rejects duplicate names with 409 PROVIDER_NAME_TAKEN', async () => {
      const res = await asAdmin().post('/admin/providers', {
        name: 'Mock AI',
        type: 'MOCK',
        model: 'x',
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PROVIDER_NAME_TAKEN');
    });

    it('editing without apiKey keeps the key; a new apiKey replaces it', async () => {
      const id = await providerId('OpenAI Test');
      const kept = await asAdmin().patch(`/admin/providers/${id}`, {
        model: 'gpt-4.1-mini',
      });
      expect(kept.status).toBe(200);
      expect(kept.body).toMatchObject({
        model: 'gpt-4.1-mini',
        apiKeyMasked: '••••9f8e',
      });

      const replaced = await asAdmin().patch(`/admin/providers/${id}`, {
        apiKey: 'sk-new-key-0000',
      });
      expect(replaced.body.apiKeyMasked).toBe('••••0000');
      await asAdmin().patch(`/admin/providers/${id}`, { apiKey: KEY });
    });

    it('the admin list never contains keys', async () => {
      const res = await asAdmin().get('/admin/providers');
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(5);
      for (const p of res.body.data) {
        expect(Object.keys(p)).not.toContain('apiKey');
      }
    });
  });

  describe('enable, disable, default (T9)', () => {
    it('only one default at a time', async () => {
      const id = await providerId('OpenAI Test');
      const res = await asAdmin().patch(`/admin/providers/${id}/default`);
      expect(res.status).toBe(200);
      expect(res.body.isDefault).toBe(true);

      const defaults = await t.dataSource.query(
        `SELECT name FROM ai_providers WHERE is_default`,
      );
      expect(defaults).toEqual([{ name: 'OpenAI Test' }]);

      // back to Mock for the other tests
      await asAdmin().patch(
        `/admin/providers/${await providerId('Mock AI')}/default`,
      );
    });

    it('disabling or deleting the default is 409 PROVIDER_IS_DEFAULT', async () => {
      const mockId = await providerId('Mock AI');
      const disable = await asAdmin().patch(
        `/admin/providers/${mockId}/status`,
        {
          isEnabled: false,
        },
      );
      expect(disable.status).toBe(409);
      expect(disable.body.code).toBe('PROVIDER_IS_DEFAULT');

      const viaEdit = await asAdmin().patch(`/admin/providers/${mockId}`, {
        isEnabled: false,
      });
      expect(viaEdit.status).toBe(409);

      const remove = await asAdmin().delete(`/admin/providers/${mockId}`);
      expect(remove.status).toBe(409);
      expect(remove.body.code).toBe('PROVIDER_IS_DEFAULT');
    });

    it('a disabled provider cannot become default', async () => {
      const res = await asAdmin().patch(
        `/admin/providers/${await providerId('Gemini')}/default`,
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PROVIDER_DISABLED');
    });

    it('a non-MOCK provider needs a key before it can be enabled', async () => {
      const res = await asAdmin().patch(
        `/admin/providers/${await providerId('Gemini')}/status`,
        { isEnabled: true },
      );
      expect(res.status).toBe(400);
    });

    it('disabled providers disappear from GET /providers', async () => {
      const id = await providerId('Second Mock');
      await asAdmin().patch(`/admin/providers/${id}/status`, {
        isEnabled: false,
      });
      const res = await t
        .http()
        .get(t.api('/providers'))
        .set(bearer(alice))
        .expect(200);
      expect(res.body.map((p: { name: string }) => p.name)).not.toContain(
        'Second Mock',
      );
    });

    it('deletes a non-default provider', async () => {
      const id = await providerId('Second Mock');
      expect((await asAdmin().delete(`/admin/providers/${id}`)).status).toBe(
        204,
      );
      expect((await asAdmin().delete(`/admin/providers/${id}`)).status).toBe(
        404,
      );
    });
  });

  describe('health checks (PR-7)', () => {
    it('checks one provider, saves UP and logs it', async () => {
      const id = await providerId('Mock AI');
      const res = await asAdmin().post(`/admin/providers/${id}/health-check`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        providerId: id,
        status: 'UP',
        latencyMs: expect.any(Number),
        error: null,
      });

      await t.flushLogs();
      const [log] = await t.dataSource.query(
        `SELECT feature, provider_id, ai_success FROM api_usage_logs WHERE path LIKE '%/health-check' ORDER BY id DESC LIMIT 1`,
      );
      expect(log).toEqual({
        feature: 'HEALTH_CHECK',
        provider_id: id,
        ai_success: true,
      });
      const [row] = await t.dataSource.query(
        `SELECT health, health_checked_at FROM ai_providers WHERE id = $1`,
        [id],
      );
      expect(row.health).toBe('UP');
      expect(row.health_checked_at).not.toBeNull();
    });

    it('a rejected key makes the provider DOWN (fetch mocked, no network)', async () => {
      const fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 401 }));
      const id = await providerId('OpenAI Test');
      const res = await asAdmin().post(`/admin/providers/${id}/health-check`);
      expect(res.body).toMatchObject({
        status: 'DOWN',
        error: 'OpenAI returned HTTP 401',
      });
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/models/gpt-4.1-mini');
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${KEY}`,
      );
    });

    it('checks all enabled providers with one log row each', async () => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));
      const res = await asAdmin().get('/admin/providers/health');
      expect(res.status).toBe(200);
      expect(res.body.map((r: { name: string }) => r.name).sort()).toEqual([
        'Mock AI',
        'OpenAI Test',
      ]);
      expect(res.body.every((r: { status: string }) => r.status === 'UP')).toBe(
        true,
      );

      await t.flushLogs();
      const rows = await t.dataSource.query(
        `SELECT count(*)::int AS n FROM api_usage_logs WHERE path = '/api/v1/admin/providers/health' AND feature = 'HEALTH_CHECK'`,
      );
      expect(rows[0].n).toBe(2);
    });

    it('404 for an unknown provider', async () => {
      const res = await asAdmin().post(
        '/admin/providers/00000000-0000-4000-8000-000000000000/health-check',
      );
      expect(res.status).toBe(404);
    });
  });
});
