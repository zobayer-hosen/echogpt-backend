import { bearer, DEMO, login, registerUser } from '../setup/factories';
import { createTestApp, TestContext } from '../setup/test-app';

describe('Plans and subscriptions (e2e)', () => {
  let t: TestContext;
  let adminToken: string;

  beforeAll(async () => {
    t = await createTestApp();
    adminToken = (await login(t, DEMO.admin)).accessToken;
  });

  afterAll(async () => {
    await t.close();
  });

  it('GET /plans is public and uses the env limits', async () => {
    const res = await t.http().get(t.api('/plans')).expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        code: 'FREE',
        name: 'Free',
        dailyLimit: 20,
        price: 0,
      }),
      expect.objectContaining({
        code: 'PREMIUM',
        name: 'Premium',
        dailyLimit: 500,
        price: 9.99,
      }),
    ]);
  });

  it('GET /subscriptions/me shows the plan', async () => {
    const bob = await login(t, DEMO.bob);
    const res = await t
      .http()
      .get(t.api('/subscriptions/me'))
      .set(bearer(bob.accessToken))
      .expect(200);
    expect(res.body).toMatchObject({
      plan: 'PREMIUM',
      planName: 'Premium',
      dailyLimit: 500,
      startedAt: expect.any(String),
    });
  });

  it('changing plan updates plan and started_at; same plan is 409', async () => {
    const user = await registerUser(t);
    const before = await t
      .http()
      .get(t.api('/subscriptions/me'))
      .set(bearer(user.accessToken));

    const same = await t
      .http()
      .post(t.api('/subscriptions/me/change'))
      .set(bearer(user.accessToken))
      .send({ plan: 'FREE' })
      .expect(409);
    expect(same.body.code).toBe('ALREADY_ON_PLAN');

    const res = await t
      .http()
      .post(t.api('/subscriptions/me/change'))
      .set(bearer(user.accessToken))
      .send({ plan: 'PREMIUM' })
      .expect(200);
    expect(res.body).toMatchObject({ plan: 'PREMIUM', dailyLimit: 500 });
    expect(new Date(res.body.startedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before.body.startedAt).getTime(),
    );

    const me = await t
      .http()
      .get(t.api('/users/me'))
      .set(bearer(user.accessToken));
    expect(me.body.plan).toBe('PREMIUM');
  });

  it('rejects an unknown plan with 400', async () => {
    const user = await registerUser(t);
    const res = await t
      .http()
      .post(t.api('/subscriptions/me/change'))
      .set(bearer(user.accessToken))
      .send({ plan: 'GOLD' })
      .expect(400);
    expect(res.body.details.plan).toBeDefined();
  });

  describe('/admin/subscriptions', () => {
    it('lists plans with today’s usage and filters by plan', async () => {
      const res = await t
        .http()
        .get(t.api('/admin/subscriptions?plan=PREMIUM'))
        .set(bearer(adminToken))
        .expect(200);
      expect(res.body.data.map((s: { email: string }) => s.email)).toEqual(
        expect.arrayContaining([DEMO.admin, DEMO.bob]),
      );
      expect(
        res.body.data.every((s: { plan: string }) => s.plan === 'PREMIUM'),
      ).toBe(true);
      expect(res.body.data[0]).toMatchObject({
        dailyLimit: 500,
        usedToday: expect.any(Number),
        remainingToday: expect.any(Number),
      });
    });

    it("changes a user's plan", async () => {
      const user = await registerUser(t);
      const res = await t
        .http()
        .patch(t.api(`/admin/subscriptions/${user.id}`))
        .set(bearer(adminToken))
        .send({ plan: 'PREMIUM' })
        .expect(200);
      expect(res.body).toMatchObject({
        userId: user.id,
        plan: 'PREMIUM',
        dailyLimit: 500,
        usedToday: 0,
        remainingToday: 500,
      });
      await t
        .http()
        .patch(t.api(`/admin/subscriptions/${user.id}`))
        .set(bearer(adminToken))
        .send({ plan: 'PREMIUM' })
        .expect(409);
    });

    it('404 for an unknown user, 403 for a USER', async () => {
      await t
        .http()
        .patch(
          t.api('/admin/subscriptions/00000000-0000-4000-8000-000000000000'),
        )
        .set(bearer(adminToken))
        .send({ plan: 'PREMIUM' })
        .expect(404);
      const alice = await login(t, DEMO.alice);
      await t
        .http()
        .get(t.api('/admin/subscriptions'))
        .set(bearer(alice.accessToken))
        .expect(403);
    });
  });
});
