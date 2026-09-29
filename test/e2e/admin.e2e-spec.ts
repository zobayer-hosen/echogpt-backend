import {
  bearer,
  DEMO,
  login,
  registerUser,
  TestUser,
} from '../setup/factories';
import { createTestApp, TestContext } from '../setup/test-app';

describe('Admin views (e2e)', () => {
  let t: TestContext;
  let admin: string;
  let user: TestUser;

  const adminGet = (path: string) =>
    t.http().get(t.api(path)).set(bearer(admin));

  beforeAll(async () => {
    t = await createTestApp();
    admin = (await login(t, DEMO.admin)).accessToken;
    user = await registerUser(t);

    // some activity: 2 chats, 1 failed chat, 2 searches (1 cached)
    const auth = bearer(user.accessToken);
    await t
      .http()
      .post(t.api('/chat/messages'))
      .set(auth)
      .send({ prompt: 'one' });
    await t
      .http()
      .post(t.api('/chat/messages'))
      .set(auth)
      .send({ prompt: 'two' });
    await t
      .http()
      .post(t.api('/chat/messages'))
      .set(auth)
      .send({ prompt: 'boom [mock-error]' });
    await t
      .http()
      .post(t.api('/search'))
      .set(auth)
      .send({ query: 'same query' });
    await t
      .http()
      .post(t.api('/search'))
      .set(auth)
      .send({ query: 'same query' });
    await t.flushLogs();
  });

  afterAll(async () => {
    await t.close();
  });

  it('every /admin view is 403 for a USER (T4)', async () => {
    for (const path of [
      '/admin/dashboard',
      '/admin/analytics/usage',
      '/admin/logs/requests',
      '/admin/health',
      '/admin/users',
      '/admin/subscriptions',
      '/admin/providers',
    ]) {
      const res = await t.http().get(t.api(path)).set(bearer(user.accessToken));
      expect([path, res.status]).toEqual([path, 403]);
    }
  });

  it('GET /admin/dashboard (AD-1)', async () => {
    const res = await adminGet('/admin/dashboard').expect(200);
    expect(res.body).toMatchObject({
      users: { total: 4, newLast7Days: 4, byPlan: { FREE: 2, PREMIUM: 2 } },
      requestsToday: {
        http: expect.any(Number),
        chat: 2,
        search: 2,
      },
      aiLast24h: { calls: 4, errors: 1, errorRate: 0.25 },
      generatedAt: expect.any(String),
    });
    expect(res.body.requestsToday.http).toBeGreaterThan(5);
    expect(res.body.providers[0]).toMatchObject({
      name: 'Mock AI',
      isDefault: true,
    });
  });

  describe('GET /admin/analytics/usage (AD-5)', () => {
    it('groups AI calls by feature', async () => {
      const res = await adminGet(
        '/admin/analytics/usage?groupBy=feature',
      ).expect(200);
      expect(res.body.groupBy).toBe('feature');
      expect(res.body.rows).toEqual([
        expect.objectContaining({
          key: 'CHAT',
          requests: 3,
          successes: 2,
          failures: 1,
          successRate: 0.6667,
        }),
        expect.objectContaining({
          key: 'SEARCH',
          requests: 1,
          successes: 1,
          successRate: 1,
        }),
      ]);
      expect(res.body.totals).toMatchObject({ requests: 4, successes: 3 });
    });

    it('groups by provider with names, and by UTC day', async () => {
      const byProvider = await adminGet(
        '/admin/analytics/usage?groupBy=provider',
      ).expect(200);
      expect(byProvider.body.rows).toEqual([
        expect.objectContaining({ label: 'Mock AI', requests: 4 }),
      ]);

      const byDay = await adminGet('/admin/analytics/usage').expect(200);
      expect(byDay.body.groupBy).toBe('day');
      expect(byDay.body.rows).toEqual([
        expect.objectContaining({
          key: new Date().toISOString().slice(0, 10),
          requests: 4,
        }),
      ]);
    });

    it('validates groupBy and the range', async () => {
      await adminGet('/admin/analytics/usage?groupBy=week').expect(400);
      await adminGet(
        '/admin/analytics/usage?from=2026-09-10T00:00:00Z&to=2026-09-01T00:00:00Z',
      ).expect(400);
      await adminGet('/admin/analytics/usage?from=yesterday').expect(400);
      const empty = await adminGet(
        '/admin/analytics/usage?from=2020-01-01T00:00:00Z&to=2020-01-02T00:00:00Z',
      ).expect(200);
      expect(empty.body.rows).toEqual([]);
      expect(empty.body.totals).toMatchObject({ requests: 0, successRate: 0 });
    });
  });

  describe('GET /admin/logs/requests (AD-6)', () => {
    it('filters by user, status and path; newest first; paginated', async () => {
      const mine = await adminGet(
        `/admin/logs/requests?userId=${user.id}&path=/chat&limit=100`,
      ).expect(200);
      // 2 answered chats + 1 failed chat
      expect(mine.body.meta.total).toBe(3);
      // the USER's 403s on /admin/* (T4 test above) are logged too
      const forbidden = await adminGet(
        `/admin/logs/requests?userId=${user.id}&status=403`,
      ).expect(200);
      expect(forbidden.body.meta.total).toBe(7);
      const times = mine.body.data.map((l: { createdAt: string }) =>
        new Date(l.createdAt).getTime(),
      );
      expect([...times].sort((a, b) => b - a)).toEqual(times);

      const failed = await adminGet(
        `/admin/logs/requests?userId=${user.id}&status=502`,
      ).expect(200);
      expect(failed.body.data).toEqual([
        expect.objectContaining({
          method: 'POST',
          path: '/api/v1/chat/messages',
          statusCode: 502,
          feature: 'CHAT',
          aiSuccess: false,
          userId: user.id,
        }),
      ]);

      const searches = await adminGet(
        '/admin/logs/requests?path=/SEARCH&limit=1',
      ).expect(200);
      expect(searches.body.data).toHaveLength(1);
      expect(searches.body.meta.total).toBe(2);
      expect(searches.body.data[0].path).toBe('/api/v1/search');
    });

    it('filters by time and validates the query', async () => {
      const future = await adminGet(
        '/admin/logs/requests?from=2099-01-01T00:00:00Z',
      ).expect(200);
      expect(future.body.data).toEqual([]);
      await adminGet('/admin/logs/requests?status=999').expect(400);
      await adminGet('/admin/logs/requests?userId=nope').expect(400);
    });
  });

  it('GET /admin/health (AD-7)', async () => {
    const res = await adminGet('/admin/health').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      database: { status: 'up', latencyMs: expect.any(Number) },
      uptimeSeconds: expect.any(Number),
      memory: {
        rssMb: expect.any(Number),
        heapUsedMb: expect.any(Number),
        heapTotalMb: expect.any(Number),
      },
      nodeVersion: process.version,
    });
    expect(res.body.providers).toHaveLength(4);
  });
});
