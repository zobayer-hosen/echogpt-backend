import { MockAdapter } from '../../src/modules/providers/adapters/mock.adapter';
import { bearer, registerUser, TestUser } from '../setup/factories';
import { createTestApp, TestContext } from '../setup/test-app';

describe('Search (e2e)', () => {
  let t: TestContext;

  const search = (user: TestUser, body: object) =>
    t.http().post(t.api('/search')).set(bearer(user.accessToken)).send(body);
  const get = (user: TestUser, path: string) =>
    t.http().get(t.api(path)).set(bearer(user.accessToken));

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await t.close();
  });

  describe('POST /search (WS-1)', () => {
    it('returns answer + results, saves the search and counts one request', async () => {
      const user = await registerUser(t);
      const res = await search(user, { query: 'What is NestJS?' }).expect(200);
      expect(res.body).toMatchObject({
        query: 'What is NestJS?',
        answer: expect.stringContaining('What is NestJS?'),
        fromCache: false,
        providerId: expect.any(String),
        usage: { used: 1, remaining: 19 },
      });
      expect(res.body.results).toHaveLength(3);
      expect(res.body.results[0]).toEqual({
        title: expect.any(String),
        url: expect.stringMatching(/^https:\/\//),
        snippet: expect.any(String),
      });

      const [row] = await t.dataSource.query(
        `SELECT normalized_query, from_cache FROM web_searches WHERE id = $1`,
        [res.body.id],
      );
      expect(row).toEqual({
        normalized_query: 'what is nestjs?',
        from_cache: false,
      });
    });

    it('validates the query', async () => {
      const user = await registerUser(t);
      await search(user, { query: 'x' }).expect(400);
      await search(user, { query: 'x'.repeat(301) }).expect(400);
      await search(user, { query: 'ok query', extra: 1 }).expect(400);
      expect((await get(user, '/subscriptions/me/usage')).body.used).toBe(0);
    });

    it('provider failure → 502, request given back, nothing saved', async () => {
      const user = await registerUser(t);
      const res = await search(user, {
        query: 'fail please [mock-error]',
      }).expect(502);
      expect(res.body.code).toBe('PROVIDER_ERROR');
      expect((await get(user, '/subscriptions/me/usage')).body.used).toBe(0);
      expect((await get(user, '/search/history')).body.meta.total).toBe(0);
    });
  });

  describe('cache (T10, WS-5)', () => {
    it('a second identical search is served from cache and the provider is called once', async () => {
      const spy = jest.spyOn(MockAdapter.prototype, 'search');
      const first = await registerUser(t);
      const second = await registerUser(t);
      const query = `cache test ${Date.now()}`;

      const a = await search(first, { query }).expect(200);
      const b = await search(second, {
        query: `  ${query.toUpperCase()} `,
      }).expect(200);

      expect(a.body.fromCache).toBe(false);
      expect(b.body.fromCache).toBe(true);
      expect(b.body.answer).toBe(a.body.answer);
      expect(b.body.results).toEqual(a.body.results);
      expect(spy).toHaveBeenCalledTimes(1);
      // a cached search still counts as one request
      expect(b.body.usage.used).toBe(1);

      await t.flushLogs();
      const logs = await t.dataSource.query(
        `SELECT user_id, feature, ai_success FROM api_usage_logs WHERE path = '/api/v1/search' AND user_id = ANY($1) ORDER BY id`,
        [[first.id, second.id]],
      );
      expect(logs).toEqual([
        { user_id: first.id, feature: 'SEARCH', ai_success: true },
        { user_id: second.id, feature: null, ai_success: null },
      ]);
    });

    it('expires after the TTL and is per provider', async () => {
      const spy = jest.spyOn(MockAdapter.prototype, 'search');
      const user = await registerUser(t);
      const query = `ttl test ${Date.now()}`;
      await search(user, { query }).expect(200);

      // older than 1 hour → miss
      await t.dataSource.query(
        `UPDATE web_searches SET created_at = now() - interval '2 hours' WHERE normalized_query = $1`,
        [query],
      );
      const stale = await search(user, { query }).expect(200);
      expect(stale.body.fromCache).toBe(false);

      // another provider → miss
      const [other] = await t.dataSource.query(
        `INSERT INTO ai_providers (name, type, model) VALUES ('Mock Two', 'MOCK', 'mock-2') RETURNING id`,
      );
      const otherProvider = await search(user, {
        query,
        providerId: other.id,
      }).expect(200);
      expect(otherProvider.body.fromCache).toBe(false);
      expect(spy).toHaveBeenCalledTimes(3);
    });
  });

  describe('history (WS-2)', () => {
    it('lists own searches newest first, deletes one and all', async () => {
      const user = await registerUser(t);
      const stranger = await registerUser(t);
      for (const query of ['first query', 'second query', 'third query']) {
        await search(user, { query }).expect(200);
      }
      await search(stranger, { query: 'not yours' }).expect(200);

      const page = await get(user, '/search/history?limit=2').expect(200);
      expect(page.body.data.map((s: { query: string }) => s.query)).toEqual([
        'third query',
        'second query',
      ]);
      expect(page.body.meta).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });

      const strangerRow = (await get(stranger, '/search/history')).body.data[0];
      await t
        .http()
        .delete(t.api(`/search/history/${strangerRow.id}`))
        .set(bearer(user.accessToken))
        .expect(404);

      await t
        .http()
        .delete(t.api(`/search/history/${page.body.data[0].id}`))
        .set(bearer(user.accessToken))
        .expect(204);
      expect((await get(user, '/search/history')).body.meta.total).toBe(2);

      await t
        .http()
        .delete(t.api('/search/history'))
        .set(bearer(user.accessToken))
        .expect(204);
      expect((await get(user, '/search/history')).body.meta.total).toBe(0);
      expect((await get(stranger, '/search/history')).body.meta.total).toBe(1);
    });
  });

  describe('recent (WS-3)', () => {
    it('returns the last 10 distinct queries, newest first', async () => {
      const user = await registerUser(t);
      await t.dataSource.query(
        `INSERT INTO web_searches (user_id, query, normalized_query, answer, results, created_at)
         SELECT $1, 'Query ' || n, 'query ' || n, 'a', '[]', now() - (n || ' minutes')::interval
           FROM generate_series(1, 12) AS n`,
        [user.id],
      );
      // a repeat of an old query moves it to the top, once
      await search(user, { query: 'QUERY 12' }).expect(200);

      const res = await get(user, '/search/recent').expect(200);
      expect(res.body).toHaveLength(10);
      expect(res.body.map((r: { query: string }) => r.query)).toEqual([
        'QUERY 12',
        'Query 1',
        'Query 2',
        'Query 3',
        'Query 4',
        'Query 5',
        'Query 6',
        'Query 7',
        'Query 8',
        'Query 9',
      ]);
    });
  });

  describe('suggestions (WS-4)', () => {
    it('own history first, then queries popular with several users', async () => {
      const me = await registerUser(t);
      const others = [await registerUser(t), await registerUser(t)];

      await search(me, { query: 'Chrome extension security' }).expect(200);
      for (const other of others) {
        await search(other, { query: 'chrome extension manifest v3' }).expect(
          200,
        );
      }
      // searched by only one other user → private, never suggested
      await search(others[0], {
        query: 'chrome extension private thing',
      }).expect(200);

      const res = await get(me, '/search/suggestions?q=CHROME%20ext').expect(
        200,
      );
      expect(res.body).toEqual([
        { query: 'Chrome extension security', source: 'HISTORY' },
        { query: 'chrome extension manifest v3', source: 'POPULAR' },
      ]);
    });

    it('caps at 8, escapes LIKE wildcards and requires q', async () => {
      const me = await registerUser(t);
      await t.dataSource.query(
        `INSERT INTO web_searches (user_id, query, normalized_query, answer, results)
         SELECT $1, 'zeta ' || n, 'zeta ' || n, 'a', '[]' FROM generate_series(1, 12) AS n`,
        [me.id],
      );
      expect((await get(me, '/search/suggestions?q=zeta')).body).toHaveLength(
        8,
      );
      expect((await get(me, '/search/suggestions?q=%25')).body).toEqual([]);
      await get(me, '/search/suggestions').expect(400);
    });
  });
});
