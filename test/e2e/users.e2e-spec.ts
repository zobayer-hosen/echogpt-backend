import {
  bearer,
  DEMO,
  login,
  registerUser,
  uniqueEmail,
} from '../setup/factories';
import { createTestApp, TestContext } from '../setup/test-app';

describe('Users (e2e)', () => {
  let t: TestContext;
  let adminToken: string;

  beforeAll(async () => {
    t = await createTestApp();
    adminToken = (await login(t, DEMO.admin)).accessToken;
  });

  afterAll(async () => {
    await t.close();
  });

  describe('/users/me', () => {
    it('T1: register → login → GET /users/me', async () => {
      const email = uniqueEmail('t1');
      await t
        .http()
        .post(t.api('/auth/register'))
        .send({ email, password: 'Secret123!', fullName: 'Tee One' })
        .expect(201);
      const session = await login(t, email, 'Secret123!');
      const res = await t
        .http()
        .get(t.api('/users/me'))
        .set(bearer(session.accessToken))
        .expect(200);
      expect(res.body).toEqual({
        id: session.id,
        email,
        fullName: 'Tee One',
        avatarUrl: null,
        role: 'USER',
        isEmailVerified: false,
        plan: 'FREE',
        createdAt: expect.any(String),
      });
    });

    it('updates only fullName and avatarUrl', async () => {
      const user = await registerUser(t);
      const res = await t
        .http()
        .patch(t.api('/users/me'))
        .set(bearer(user.accessToken))
        .send({
          fullName: 'New Name',
          avatarUrl: 'https://cdn.example.com/a.png',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        fullName: 'New Name',
        avatarUrl: 'https://cdn.example.com/a.png',
      });

      const cleared = await t
        .http()
        .patch(t.api('/users/me'))
        .set(bearer(user.accessToken))
        .send({ avatarUrl: null })
        .expect(200);
      expect(cleared.body.avatarUrl).toBeNull();
    });

    it('rejects unknown fields, null names and bad URLs with 400', async () => {
      const user = await registerUser(t);
      for (const body of [
        { email: 'x@y.z' },
        { role: 'ADMIN' },
        { fullName: null },
        { avatarUrl: 'javascript:alert(1)' },
        {},
      ]) {
        const res = await t
          .http()
          .patch(t.api('/users/me'))
          .set(bearer(user.accessToken))
          .send(body)
          .expect(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('change password', () => {
    it('needs the right current password', async () => {
      const user = await registerUser(t);
      const res = await t
        .http()
        .patch(t.api('/users/me/password'))
        .set(bearer(user.accessToken))
        .send({ currentPassword: 'Wrong123!', newPassword: 'Other123!' })
        .expect(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects a new password equal to the old one', async () => {
      const user = await registerUser(t);
      const res = await t
        .http()
        .patch(t.api('/users/me/password'))
        .set(bearer(user.accessToken))
        .send({ currentPassword: user.password, newPassword: user.password })
        .expect(400);
      expect(res.body.details.newPassword).toBeDefined();
    });

    it('changes it and logs out every other session, keeping this one', async () => {
      const user = await registerUser(t);
      const other = await login(t, user.email, user.password);

      await t
        .http()
        .patch(t.api('/users/me/password'))
        .set(bearer(user.accessToken))
        .send({ currentPassword: user.password, newPassword: 'Brand9New' })
        .expect(204);

      await t
        .http()
        .get(t.api('/users/me'))
        .set(bearer(user.accessToken))
        .expect(200);
      await t
        .http()
        .get(t.api('/users/me'))
        .set(bearer(other.accessToken))
        .expect(401);
      await t
        .http()
        .post(t.api('/auth/login'))
        .send({ email: user.email, password: user.password })
        .expect(401);
      await login(t, user.email, 'Brand9New');
    });
  });

  describe('delete account', () => {
    it('needs the password', async () => {
      const user = await registerUser(t);
      await t
        .http()
        .delete(t.api('/users/me'))
        .set(bearer(user.accessToken))
        .send({ password: 'Wrong123!' })
        .expect(401);
    });

    it('soft-deletes, revokes sessions and frees the email', async () => {
      const user = await registerUser(t);
      await t
        .http()
        .delete(t.api('/users/me'))
        .set(bearer(user.accessToken))
        .send({ password: user.password })
        .expect(204);

      await t
        .http()
        .get(t.api('/users/me'))
        .set(bearer(user.accessToken))
        .expect(401);
      await t
        .http()
        .post(t.api('/auth/login'))
        .send({ email: user.email, password: user.password })
        .expect(401);

      const [row] = await t.dataSource.query(
        `SELECT deleted_at FROM users WHERE id = $1`,
        [user.id],
      );
      expect(row.deleted_at).not.toBeNull();

      // the same email can register again
      await registerUser(t, { email: user.email });
    });

    it('the last admin cannot delete themselves (409 LAST_ADMIN)', async () => {
      const res = await t
        .http()
        .delete(t.api('/users/me'))
        .set(bearer(adminToken))
        .send({ password: DEMO.password })
        .expect(409);
      expect(res.body.code).toBe('LAST_ADMIN');
    });
  });

  describe('/admin/users', () => {
    it('lists with search, filters and pagination', async () => {
      const byEmail = await t
        .http()
        .get(t.api('/admin/users?search=ALICE'))
        .set(bearer(adminToken))
        .expect(200);
      expect(byEmail.body.data.map((u: { email: string }) => u.email)).toEqual([
        DEMO.alice,
      ]);
      expect(byEmail.body.data[0]).toMatchObject({
        plan: 'FREE',
        status: 'ACTIVE',
        role: 'USER',
      });
      expect(JSON.stringify(byEmail.body)).not.toMatch(/password|hash/i);

      const premiumAdmins = await t
        .http()
        .get(t.api('/admin/users?plan=PREMIUM&role=ADMIN'))
        .set(bearer(adminToken))
        .expect(200);
      expect(
        premiumAdmins.body.data.map((u: { email: string }) => u.email),
      ).toEqual([DEMO.admin]);

      const page = await t
        .http()
        .get(t.api('/admin/users?page=2&limit=1'))
        .set(bearer(adminToken))
        .expect(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.meta).toMatchObject({ page: 2, limit: 1 });
      expect(page.body.meta.totalPages).toBe(page.body.meta.total);
    });

    it('treats LIKE wildcards in search literally', async () => {
      const res = await t
        .http()
        .get(t.api('/admin/users?search=%25'))
        .set(bearer(adminToken))
        .expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('validates the query and the id', async () => {
      await t
        .http()
        .get(t.api('/admin/users?limit=500'))
        .set(bearer(adminToken))
        .expect(400);
      await t
        .http()
        .get(t.api('/admin/users/not-a-uuid'))
        .set(bearer(adminToken))
        .expect(400);
      await t
        .http()
        .get(t.api('/admin/users/00000000-0000-4000-8000-000000000000'))
        .set(bearer(adminToken))
        .expect(404);
    });

    it('suspending a user revokes their sessions and blocks login', async () => {
      const user = await registerUser(t);
      const res = await t
        .http()
        .patch(t.api(`/admin/users/${user.id}`))
        .set(bearer(adminToken))
        .send({ status: 'SUSPENDED' })
        .expect(200);
      expect(res.body.status).toBe('SUSPENDED');

      await t
        .http()
        .get(t.api('/users/me'))
        .set(bearer(user.accessToken))
        .expect(401);
      const loginRes = await t
        .http()
        .post(t.api('/auth/login'))
        .send({ email: user.email, password: user.password })
        .expect(403);
      expect(loginRes.body.code).toBe('ACCOUNT_DISABLED');

      await t
        .http()
        .patch(t.api(`/admin/users/${user.id}`))
        .set(bearer(adminToken))
        .send({ status: 'ACTIVE' })
        .expect(200);
      await login(t, user.email, user.password);
    });

    it('protects the last active admin from demotion and suspension', async () => {
      const me = await t.http().get(t.api('/users/me')).set(bearer(adminToken));
      for (const body of [{ role: 'USER' }, { status: 'SUSPENDED' }]) {
        const res = await t
          .http()
          .patch(t.api(`/admin/users/${me.body.id}`))
          .set(bearer(adminToken))
          .send(body)
          .expect(409);
        expect(res.body.code).toBe('LAST_ADMIN');
      }
      await t
        .http()
        .delete(t.api(`/admin/users/${me.body.id}`))
        .set(bearer(adminToken))
        .expect(409);
    });

    it('deletes a user (soft)', async () => {
      const user = await registerUser(t);
      await t
        .http()
        .delete(t.api(`/admin/users/${user.id}`))
        .set(bearer(adminToken))
        .expect(204);
      await t
        .http()
        .get(t.api(`/admin/users/${user.id}`))
        .set(bearer(adminToken))
        .expect(404);
      await t
        .http()
        .get(t.api('/users/me'))
        .set(bearer(user.accessToken))
        .expect(401);
    });
  });
});
