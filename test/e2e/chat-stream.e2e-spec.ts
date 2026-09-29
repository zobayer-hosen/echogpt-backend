import { bearer, registerUser, TestUser } from '../setup/factories';
import { createTestApp, TestContext } from '../setup/test-app';

interface Frame {
  event: string;
  data: any;
}

/** Splits a raw text/event-stream body into frames. */
function frames(raw: string): Frame[] {
  return raw
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      return {
        event: lines.find((l) => l.startsWith('event: '))!.slice(7),
        data: JSON.parse(lines.find((l) => l.startsWith('data: '))!.slice(6)),
      };
    });
}

describe('Chat streaming (e2e, CH-5)', () => {
  let t: TestContext;

  const stream = (user: TestUser, conversationId: string, prompt: string) =>
    t
      .http()
      .post(t.api(`/chat/conversations/${conversationId}/messages/stream`))
      .set(bearer(user.accessToken))
      .send({ prompt })
      .buffer(true)
      .parse((res, done) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => done(null, body));
      });
  const newConversation = async (user: TestUser): Promise<string> =>
    (
      await t
        .http()
        .post(t.api('/chat/conversations'))
        .set(bearer(user.accessToken))
        .send({})
        .expect(201)
    ).body.id;
  const usedToday = async (user: TestUser): Promise<number> =>
    (
      await t
        .http()
        .get(t.api('/subscriptions/me/usage'))
        .set(bearer(user.accessToken))
    ).body.used;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('streams token events, then done with the saved messages and usage', async () => {
    const user = await registerUser(t);
    const conversationId = await newConversation(user);

    const res = await stream(user, conversationId, 'Tell me a story').expect(
      200,
    );
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);

    const all = frames(res.body as string);
    const tokens = all.filter((f) => f.event === 'token');
    const done = all[all.length - 1];
    expect(tokens.length).toBeGreaterThan(5);
    expect(done.event).toBe('done');
    expect(done.data.assistantMessage.content).toBe(
      tokens.map((f) => f.data.text).join(''),
    );
    expect(done.data).toMatchObject({
      conversation: { id: conversationId, title: 'Tell me a story' },
      userMessage: { role: 'USER', content: 'Tell me a story' },
      assistantMessage: { role: 'ASSISTANT', providerId: expect.any(String) },
      usage: { used: 1, remaining: 19 },
    });

    const detail = await t
      .http()
      .get(t.api(`/chat/conversations/${conversationId}`))
      .set(bearer(user.accessToken))
      .expect(200);
    expect(detail.body.messages.map((m: { id: string }) => m.id)).toEqual([
      done.data.userMessage.id,
      done.data.assistantMessage.id,
    ]);

    await t.flushLogs();
    const [log] = await t.dataSource.query(
      `SELECT status_code, feature, ai_success FROM api_usage_logs WHERE user_id = $1 AND path LIKE '%/stream' ORDER BY id DESC LIMIT 1`,
      [user.id],
    );
    expect(log).toEqual({
      status_code: 200,
      feature: 'CHAT',
      ai_success: true,
    });
  });

  it('a provider failure mid-stream sends an error event, gives the request back and saves nothing', async () => {
    const user = await registerUser(t);
    const conversationId = await newConversation(user);

    const res = await stream(user, conversationId, 'break [mock-error]').expect(
      200,
    );
    const all = frames(res.body as string);
    expect(all.map((f) => f.event)).toEqual(['token', 'token', 'error']);
    expect(all[2].data).toEqual({
      code: 'PROVIDER_ERROR',
      message: 'Mock returned an error (simulated)',
    });

    expect(await usedToday(user)).toBe(0);
    const [row] = await t.dataSource.query(
      `SELECT count(*)::int AS n FROM chat_messages WHERE conversation_id = $1`,
      [conversationId],
    );
    expect(row.n).toBe(0);
  });

  it('errors before streaming are normal JSON responses', async () => {
    const owner = await registerUser(t);
    const stranger = await registerUser(t);
    const conversationId = await newConversation(owner);

    const notYours = await stream(stranger, conversationId, 'hi').expect(404);
    expect(notYours.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(notYours.body as string).code).toBe('NOT_FOUND');

    await t.dataSource.query(
      `UPDATE subscriptions SET requests_used = 20, usage_date = CURRENT_DATE WHERE user_id = $1`,
      [owner.id],
    );
    const limited = await stream(owner, conversationId, 'hi').expect(429);
    expect(JSON.parse(limited.body as string).code).toBe(
      'USAGE_LIMIT_EXCEEDED',
    );

    await stream(owner, conversationId, '').expect(400);
  });
});
