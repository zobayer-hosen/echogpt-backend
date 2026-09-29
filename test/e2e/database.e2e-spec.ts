import { runSeed } from '../../src/database/seeds/seed';
import { AiProvider } from '../../src/modules/providers/entities/ai-provider.entity';
import { User } from '../../src/modules/users/entities/user.entity';
import { createTestApp, TestContext } from '../setup/test-app';

const PG_UNIQUE = '23505';
const PG_CHECK = '23514';

describe('Database schema, seed and request logs (e2e)', () => {
  let t: TestContext;

  const q = (sql: string, params: unknown[] = []) =>
    t.dataSource.query(sql, params);
  const userId = async (email: string): Promise<string> =>
    (await q(`SELECT id FROM users WHERE email = $1`, [email]))[0].id;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('has the 9 ERD tables and 5 enums', async () => {
    const tables = await q(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'migrations' ORDER BY 1`,
    );
    expect(tables.map((r: { table_name: string }) => r.table_name)).toEqual([
      'ai_providers',
      'api_usage_logs',
      'chat_messages',
      'conversations',
      'roles',
      'sessions',
      'subscriptions',
      'users',
      'web_searches',
    ]);
    const enums = await q(
      `SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY 1`,
    );
    expect(enums.map((r: { typname: string }) => r.typname)).toEqual([
      'health_status',
      'message_role',
      'plan_code',
      'provider_type',
      'user_status',
    ]);
  });

  it('uses UTC for "today"', async () => {
    const [row] = await q(`SELECT current_setting('TimeZone') AS tz`);
    expect(row.tz).toBe('UTC');
  });

  it('seeds roles, demo users with plans and a Mock default provider', async () => {
    const users = await q(
      `SELECT u.email, r.name AS role, s.plan FROM users u JOIN roles r ON r.id = u.role_id JOIN subscriptions s ON s.user_id = u.id ORDER BY u.email`,
    );
    expect(users).toEqual([
      { email: 'admin@echogpt.dev', role: 'ADMIN', plan: 'PREMIUM' },
      { email: 'alice@echogpt.dev', role: 'USER', plan: 'FREE' },
      { email: 'bob@echogpt.dev', role: 'USER', plan: 'PREMIUM' },
    ]);
    const providers = await t.dataSource.getRepository(AiProvider).find();
    expect(providers).toHaveLength(4);
    const defaults = providers.filter((p) => p.isDefault);
    expect(defaults.map((p) => [p.name, p.type, p.isEnabled])).toEqual([
      ['Mock AI', 'MOCK', true],
    ]);
  });

  it('seed is idempotent', async () => {
    const again = await runSeed(t.dataSource);
    expect(again).toEqual({ roles: 2, usersCreated: 0, providersCreated: 0 });
  });

  it('never selects password or key columns by default', async () => {
    const user = await t.dataSource
      .getRepository(User)
      .findOneByOrFail({ email: 'alice@echogpt.dev' });
    expect(user.passwordHash).toBeUndefined();
    const provider = await t.dataSource
      .getRepository(AiProvider)
      .findOneByOrFail({ name: 'Mock AI' });
    expect(provider.apiKeyEncrypted).toBeUndefined();
  });

  it('email is unique only among non-deleted users', async () => {
    const insert = () =>
      q(
        `INSERT INTO users (email, password_hash, full_name, role_id) VALUES ('dup@echogpt.dev', 'x', 'Dup', 2) RETURNING id`,
      );
    const [first] = await insert();
    await expect(insert()).rejects.toMatchObject({ code: PG_UNIQUE });
    await q(`UPDATE users SET deleted_at = now() WHERE id = $1`, [first.id]);
    await expect(insert()).resolves.toHaveLength(1);
  });

  it('allows only one subscription per user and no negative usage', async () => {
    const alice = await userId('alice@echogpt.dev');
    await expect(
      q(`INSERT INTO subscriptions (user_id) VALUES ($1)`, [alice]),
    ).rejects.toMatchObject({ code: PG_UNIQUE });
    await expect(
      q(`UPDATE subscriptions SET requests_used = -1 WHERE user_id = $1`, [
        alice,
      ]),
    ).rejects.toMatchObject({ code: PG_CHECK });
  });

  it('allows one default provider, and it must be enabled', async () => {
    await q(`UPDATE ai_providers SET is_enabled = true WHERE name = 'OpenAI'`);
    await expect(
      q(`UPDATE ai_providers SET is_default = true WHERE name = 'OpenAI'`),
    ).rejects.toMatchObject({ code: PG_UNIQUE });
    await expect(
      q(`UPDATE ai_providers SET is_enabled = false WHERE name = 'Mock AI'`),
    ).rejects.toMatchObject({ code: PG_CHECK });
  });

  it('keeps history when a provider is deleted (FK SET NULL)', async () => {
    const bob = await userId('bob@echogpt.dev');
    const [provider] = await q(
      `INSERT INTO ai_providers (name, type, model) VALUES ('Temp', 'MOCK', 'm') RETURNING id`,
    );
    const [search] = await q(
      `INSERT INTO web_searches (user_id, query, normalized_query, provider_id, answer, results) VALUES ($1, 'Hi', 'hi', $2, 'a', '[]') RETURNING id`,
      [bob, provider.id],
    );
    await q(`DELETE FROM ai_providers WHERE id = $1`, [provider.id]);
    const [row] = await q(
      `SELECT provider_id FROM web_searches WHERE id = $1`,
      [search.id],
    );
    expect(row.provider_id).toBeNull();
  });

  it('writes one api_usage_logs row per request, without query strings', async () => {
    await t.http().get(t.api('/health?probe=secret-value')).expect(200);
    await t.http().get(t.api('/does-not-exist')).expect(404);
    await t.flushLogs();
    const rows = await q(
      `SELECT method, path, status_code, duration_ms, feature FROM api_usage_logs ORDER BY id`,
    );
    expect(rows).toEqual([
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/health',
        status_code: 200,
        feature: null,
      }),
      expect.objectContaining({
        path: '/api/v1/does-not-exist',
        status_code: 404,
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain('secret-value');
  });
});
