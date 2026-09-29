import { bearer, registerUser, TestUser } from '../setup/factories';
import { createTestApp, TestContext } from '../setup/test-app';

describe('Chat (e2e)', () => {
  let t: TestContext;
  let owner: TestUser;
  let stranger: TestUser;

  const send = (user: TestUser, path: string, body: object) =>
    t.http().post(t.api(path)).set(bearer(user.accessToken)).send(body);
  const usedToday = async (user: TestUser): Promise<number> =>
    (
      await t
        .http()
        .get(t.api('/subscriptions/me/usage'))
        .set(bearer(user.accessToken))
    ).body.used;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await registerUser(t);
    stranger = await registerUser(t);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('T7: chat with MOCK saves both messages', () => {
    let conversationId: string;

    it('POST /chat/messages starts a conversation and returns the answer + usage', async () => {
      const res = await send(owner, '/chat/messages', {
        prompt:
          '  Plan a weekend in Rome for two people who love food and history  ',
      }).expect(201);

      expect(res.body.conversation.title).toBe(
        'Plan a weekend in Rome for two people who love food and hist',
      );
      expect(res.body.userMessage).toMatchObject({
        role: 'USER',
        content:
          'Plan a weekend in Rome for two people who love food and history',
        providerId: null,
        latencyMs: null,
      });
      expect(res.body.assistantMessage).toMatchObject({
        role: 'ASSISTANT',
        content: expect.stringContaining('Mock AI'),
        providerId: expect.any(String),
        latencyMs: expect.any(Number),
      });
      expect(res.body.usage).toMatchObject({
        plan: 'FREE',
        limit: 20,
        used: 1,
        remaining: 19,
      });
      conversationId = res.body.conversation.id;
    });

    it('follow-ups send the history as context', async () => {
      const res = await send(
        owner,
        `/chat/conversations/${conversationId}/messages`,
        {
          prompt: 'Make it cheaper',
        },
      ).expect(201);
      expect(res.body.assistantMessage.content).toContain(
        '2 earlier message(s)',
      );
      expect(res.body.usage.remaining).toBe(18);
    });

    it('GET /chat/conversations/:id returns the messages in order', async () => {
      const res = await t
        .http()
        .get(t.api(`/chat/conversations/${conversationId}`))
        .set(bearer(owner.accessToken))
        .expect(200);
      expect(res.body.messages.map((m: { role: string }) => m.role)).toEqual([
        'USER',
        'ASSISTANT',
        'USER',
        'ASSISTANT',
      ]);
      expect(res.body.messages[2].content).toBe('Make it cheaper');
      const times = res.body.messages.map((m: { createdAt: string }) =>
        new Date(m.createdAt).getTime(),
      );
      expect([...times].sort((a, b) => a - b)).toEqual(times);

      const [row] = await t.dataSource.query(
        `SELECT count(*)::int AS n FROM chat_messages WHERE conversation_id = $1`,
        [conversationId],
      );
      expect(row.n).toBe(4);
    });

    it('logs the AI call with feature CHAT', async () => {
      await t.flushLogs();
      const rows = await t.dataSource.query(
        `SELECT feature, ai_success, provider_id FROM api_usage_logs WHERE path = $1 ORDER BY id DESC LIMIT 1`,
        [`/api/v1/chat/conversations/${conversationId}/messages`],
      );
      expect(rows[0]).toMatchObject({
        feature: 'CHAT',
        ai_success: true,
        provider_id: expect.any(String),
      });
    });

    it("another user's conversation is 404 everywhere", async () => {
      const path = `/chat/conversations/${conversationId}`;
      const auth = bearer(stranger.accessToken);
      const responses = await Promise.all([
        t.http().get(t.api(path)).set(auth),
        t.http().patch(t.api(path)).set(auth).send({ title: 'mine now' }),
        t.http().delete(t.api(path)).set(auth),
        send(stranger, `${path}/messages`, { prompt: 'hi' }),
      ]);
      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
      }
      // and it did not count against the stranger's quota
      expect(await usedToday(stranger)).toBe(0);
    });
  });

  describe('conversations', () => {
    it('creates, lists newest first, renames and soft-deletes', async () => {
      const user = await registerUser(t);
      const first = await send(user, '/chat/conversations', {}).expect(201);
      expect(first.body.title).toBe('New chat');
      const second = await send(user, '/chat/conversations', {
        title: 'Second',
      }).expect(201);

      // a message moves the first conversation to the top and titles it
      await send(user, `/chat/conversations/${first.body.id}/messages`, {
        prompt: 'Hello there',
      }).expect(201);

      const list = await t
        .http()
        .get(t.api('/chat/conversations?limit=10'))
        .set(bearer(user.accessToken))
        .expect(200);
      expect(list.body.data.map((c: { id: string }) => c.id)).toEqual([
        first.body.id,
        second.body.id,
      ]);
      expect(list.body.data[0].title).toBe('Hello there');
      expect(list.body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      });

      const renamed = await t
        .http()
        .patch(t.api(`/chat/conversations/${second.body.id}`))
        .set(bearer(user.accessToken))
        .send({ title: 'Renamed' })
        .expect(200);
      expect(renamed.body.title).toBe('Renamed');

      await t
        .http()
        .delete(t.api(`/chat/conversations/${second.body.id}`))
        .set(bearer(user.accessToken))
        .expect(204);
      await t
        .http()
        .get(t.api(`/chat/conversations/${second.body.id}`))
        .set(bearer(user.accessToken))
        .expect(404);
      const [row] = await t.dataSource.query(
        `SELECT deleted_at FROM conversations WHERE id = $1`,
        [second.body.id],
      );
      expect(row.deleted_at).not.toBeNull();
    });

    it('validates prompt length, ids and unknown fields', async () => {
      const user = await registerUser(t);
      await send(user, '/chat/messages', { prompt: '   ' }).expect(400);
      await send(user, '/chat/messages', { prompt: 'x'.repeat(8001) }).expect(
        400,
      );
      await send(user, '/chat/messages', { prompt: 'hi', model: 'gpt' }).expect(
        400,
      );
      await send(user, '/chat/messages', {
        prompt: 'hi',
        providerId: 'nope',
      }).expect(400);
      await t
        .http()
        .get(t.api('/chat/conversations/not-a-uuid'))
        .set(bearer(user.accessToken))
        .expect(400);
      expect(await usedToday(user)).toBe(0);
    });
  });

  describe('provider selection (CH-3)', () => {
    it('unknown provider → 404, disabled provider → 409, no quota used', async () => {
      const user = await registerUser(t);
      const unknown = await send(user, '/chat/messages', {
        prompt: 'hi',
        providerId: '00000000-0000-4000-8000-000000000000',
      }).expect(404);
      expect(unknown.body.code).toBe('NOT_FOUND');

      const [gemini] = await t.dataSource.query(
        `SELECT id FROM ai_providers WHERE name = 'Gemini'`,
      );
      const disabled = await send(user, '/chat/messages', {
        prompt: 'hi',
        providerId: gemini.id,
      }).expect(409);
      expect(disabled.body.code).toBe('PROVIDER_DISABLED');
      expect(await usedToday(user)).toBe(0);
    });

    it('an explicit enabled provider is used', async () => {
      const user = await registerUser(t);
      const [mock] = await t.dataSource.query(
        `SELECT id FROM ai_providers WHERE name = 'Mock AI'`,
      );
      const res = await send(user, '/chat/messages', {
        prompt: 'hi',
        providerId: mock.id,
      }).expect(201);
      expect(res.body.assistantMessage.providerId).toBe(mock.id);
    });
  });

  describe('provider failures (PRD A8)', () => {
    it('502: request given back, nothing saved, failure logged', async () => {
      const user = await registerUser(t);
      const res = await send(user, '/chat/messages', {
        prompt: 'please fail [mock-error]',
      }).expect(502);
      expect(res.body.code).toBe('PROVIDER_ERROR');
      expect(await usedToday(user)).toBe(0);

      const [counts] = await t.dataSource.query(
        `SELECT (SELECT count(*)::int FROM conversations WHERE user_id = $1) AS conversations`,
        [user.id],
      );
      expect(counts.conversations).toBe(0);

      await t.flushLogs();
      const [log] = await t.dataSource.query(
        `SELECT status_code, feature, ai_success FROM api_usage_logs WHERE user_id = $1 AND path = '/api/v1/chat/messages' ORDER BY id DESC LIMIT 1`,
        [user.id],
      );
      expect(log).toEqual({
        status_code: 502,
        feature: 'CHAT',
        ai_success: false,
      });
    });

    it('504 on timeout, also given back', async () => {
      const user = await registerUser(t);
      const res = await send(user, '/chat/messages', {
        prompt: 'slow [mock-timeout]',
      }).expect(504);
      expect(res.body.code).toBe('PROVIDER_TIMEOUT');
      expect(await usedToday(user)).toBe(0);
    });
  });
});
