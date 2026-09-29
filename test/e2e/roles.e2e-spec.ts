import { bearer, DEMO, login } from '../setup/factories';
import { createTestApp, TestContext } from '../setup/test-app';

describe('Roles (e2e, T4)', () => {
  let t: TestContext;
  let userToken: string;
  let adminToken: string;

  beforeAll(async () => {
    t = await createTestApp();
    userToken = (await login(t, DEMO.alice)).accessToken;
    adminToken = (await login(t, DEMO.admin)).accessToken;
  });

  afterAll(async () => {
    await t.close();
  });

  it('a USER calling /admin/* gets 403 FORBIDDEN', async () => {
    const res = await t
      .http()
      .get(t.api('/admin/users'))
      .set(bearer(userToken))
      .expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('an ADMIN gets 200', async () => {
    const res = await t
      .http()
      .get(t.api('/admin/users'))
      .set(bearer(adminToken))
      .expect(200);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 20, total: 3 });
  });

  it('no token gets 401 before the role check', async () => {
    const res = await t.http().get(t.api('/admin/users')).expect(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('a role change takes effect on the next request', async () => {
    const bob = await login(t, DEMO.bob);
    await t
      .http()
      .patch(t.api(`/admin/users/${bob.id}`))
      .set(bearer(adminToken))
      .send({ role: 'ADMIN' })
      .expect(200);
    await t
      .http()
      .get(t.api('/admin/users'))
      .set(bearer(bob.accessToken))
      .expect(200);
  });
});
