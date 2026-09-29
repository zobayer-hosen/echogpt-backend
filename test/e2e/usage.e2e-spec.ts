import { AppException } from '../../src/common/exceptions/app.exception';
import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import { bearer, registerUser, TestUser } from '../setup/factories';
import { createTestApp, TestContext } from '../setup/test-app';

const nextUtcMidnight = (): string => {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();
};

describe('Usage limits (e2e)', () => {
  let t: TestContext;
  let service: SubscriptionsService;

  const setUsed = (userId: string, used: number, daysAgo = 0) =>
    t.dataSource.query(
      `UPDATE subscriptions SET requests_used = $2, usage_date = CURRENT_DATE - $3::int WHERE user_id = $1`,
      [userId, used, daysAgo],
    );

  const usage = (user: TestUser) =>
    t
      .http()
      .get(t.api('/subscriptions/me/usage'))
      .set(bearer(user.accessToken))
      .expect(200)
      .then((res) => res.body);

  beforeAll(async () => {
    t = await createTestApp();
    service = t.app.get(SubscriptionsService);
  });

  afterAll(async () => {
    await t.close();
  });

  it('a new FREE user has 20 left, resetting at 00:00 UTC', async () => {
    const user = await registerUser(t);
    expect(await usage(user)).toEqual({
      plan: 'FREE',
      limit: 20,
      used: 0,
      remaining: 20,
      resetsAt: nextUtcMidnight(),
    });
  });

  it('T5: the 21st FREE request is refused with 429; after upgrading it is allowed', async () => {
    const user = await registerUser(t);
    for (let i = 1; i <= 20; i++) {
      const u = await service.useRequest(user.id);
      expect(u.remaining).toBe(20 - i);
    }

    const error = await service.useRequest(user.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    const ex = error as AppException;
    expect(ex.getStatus()).toBe(429);
    expect(ex.code).toBe('USAGE_LIMIT_EXCEEDED');
    expect(ex.details).toEqual({
      limit: 20,
      used: 20,
      remaining: 0,
      resetsAt: new Date(nextUtcMidnight()),
    });
    expect(await usage(user)).toMatchObject({ used: 20, remaining: 0 });

    await t
      .http()
      .post(t.api('/subscriptions/me/change'))
      .set(bearer(user.accessToken))
      .send({ plan: 'PREMIUM' })
      .expect(200);
    const after = await service.useRequest(user.id);
    expect(after).toMatchObject({
      plan: 'PREMIUM',
      limit: 500,
      used: 21,
      remaining: 479,
    });
  });

  it('T6: concurrent requests at limit - 1 let exactly one through', async () => {
    const user = await registerUser(t);
    await setUsed(user.id, 19);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => service.useRequest(user.id)),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter(
      (r) =>
        r.status === 'rejected' &&
        (r.reason as AppException).code === 'USAGE_LIMIT_EXCEEDED',
    );
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(7);
    expect(await usage(user)).toMatchObject({ used: 20, remaining: 0 });
  });

  it('the counter resets when the UTC day changes', async () => {
    const user = await registerUser(t);
    await setUsed(user.id, 20, 1);
    expect(await usage(user)).toMatchObject({ used: 0, remaining: 20 });
    const u = await service.useRequest(user.id);
    expect(u).toMatchObject({ used: 1, remaining: 19 });
  });

  it('giveBackRequest returns one request, never below zero', async () => {
    const user = await registerUser(t);
    await service.useRequest(user.id);
    await service.useRequest(user.id);
    expect(await service.giveBackRequest(user.id)).toMatchObject({ used: 1 });
    expect(await service.giveBackRequest(user.id)).toMatchObject({ used: 0 });
    expect(await service.giveBackRequest(user.id)).toMatchObject({ used: 0 });
  });

  it('downgrading below today’s usage gives remaining = 0', async () => {
    const user = await registerUser(t);
    await t
      .http()
      .post(t.api('/subscriptions/me/change'))
      .set(bearer(user.accessToken))
      .send({ plan: 'PREMIUM' })
      .expect(200);
    await setUsed(user.id, 30);
    await t
      .http()
      .post(t.api('/subscriptions/me/change'))
      .set(bearer(user.accessToken))
      .send({ plan: 'FREE' })
      .expect(200);
    expect(await usage(user)).toMatchObject({
      plan: 'FREE',
      limit: 20,
      used: 30,
      remaining: 0,
    });
    await expect(service.useRequest(user.id)).rejects.toMatchObject({
      code: 'USAGE_LIMIT_EXCEEDED',
    });
  });
});
