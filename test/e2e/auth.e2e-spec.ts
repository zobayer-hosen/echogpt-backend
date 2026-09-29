import { sha256 } from '../../src/common/utils/crypto.util';
import {
  bearer,
  DEMO,
  login,
  registerUser,
  uniqueEmail,
} from '../setup/factories';
import { createTestApp, TestContext } from '../setup/test-app';

const SECRET_FIELDS =
  /passwordHash|password_hash|refreshTokenHash|refresh_token_hash/;

describe('Auth (e2e)', () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  describe('register (T1)', () => {
    it('creates a USER on FREE and returns tokens, never the hash', async () => {
      const email = uniqueEmail('Carol').toUpperCase();
      const res = await t
        .http()
        .post(t.api('/auth/register'))
        .send({ email, password: 'Secret123!', fullName: '  Carol Chen ' })
        .expect(201);

      expect(res.body).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: 900,
        refreshExpiresIn: 604800,
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        user: {
          email: email.toLowerCase(),
          fullName: 'Carol Chen',
          role: 'USER',
          plan: 'FREE',
          isEmailVerified: false,
          avatarUrl: null,
        },
      });
      expect(JSON.stringify(res.body)).not.toMatch(SECRET_FIELDS);

      const [row] = await t.dataSource.query(
        `SELECT u.password_hash, s.plan, s.requests_used FROM users u JOIN subscriptions s ON s.user_id = u.id WHERE u.id = $1`,
        [res.body.user.id],
      );
      expect(row.plan).toBe('FREE');
      expect(row.requests_used).toBe(0);
      expect(row.password_hash).toMatch(/^\$2[aby]\$10\$/);
    });

    it('rejects a duplicate email in any case with 409 EMAIL_TAKEN', async () => {
      const res = await t
        .http()
        .post(t.api('/auth/register'))
        .send({
          email: 'ALICE@echogpt.dev',
          password: 'Secret123!',
          fullName: 'Al',
        })
        .expect(409);
      expect(res.body.code).toBe('EMAIL_TAKEN');
    });

    it('validates email, password strength, name and unknown fields', async () => {
      const res = await t
        .http()
        .post(t.api('/auth/register'))
        .send({
          email: 'nope',
          password: 'short',
          fullName: 'X',
          role: 'ADMIN',
        })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(res.body.details).sort()).toEqual([
        'email',
        'fullName',
        'password',
        'role',
      ]);
    });

    it('rejects a password without a digit', async () => {
      const res = await t
        .http()
        .post(t.api('/auth/register'))
        .send({
          email: uniqueEmail(),
          password: 'onlyletters',
          fullName: 'No Digit',
        })
        .expect(400);
      expect(res.body.details.password).toBeDefined();
    });
  });

  describe('login (T1)', () => {
    it('returns tokens and the profile, creates a hashed session, sets last_login_at', async () => {
      const res = await t
        .http()
        .post(t.api('/auth/login'))
        .set('user-agent', 'jest-e2e')
        .send({ email: DEMO.alice, password: DEMO.password })
        .expect(200);
      expect(res.body.user).toMatchObject({ email: DEMO.alice, plan: 'FREE' });
      expect(JSON.stringify(res.body)).not.toMatch(SECRET_FIELDS);

      const sessions = await t.dataSource.query(
        `SELECT s.refresh_token_hash, s.user_agent, u.last_login_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1 ORDER BY s.created_at DESC LIMIT 1`,
        [DEMO.alice],
      );
      expect(sessions[0].refresh_token_hash).toBe(
        sha256(res.body.refreshToken),
      );
      expect(sessions[0].user_agent).toBe('jest-e2e');
      expect(sessions[0].last_login_at).not.toBeNull();
    });

    it('wrong password and unknown email get the same 401', async () => {
      const wrong = await t
        .http()
        .post(t.api('/auth/login'))
        .send({ email: DEMO.alice, password: 'Wrong123!' })
        .expect(401);
      const unknown = await t
        .http()
        .post(t.api('/auth/login'))
        .send({ email: 'ghost@echogpt.dev', password: 'Wrong123!' })
        .expect(401);
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
      expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('is case-insensitive on email', async () => {
      await t
        .http()
        .post(t.api('/auth/login'))
        .send({ email: 'Bob@EchoGPT.dev', password: DEMO.password })
        .expect(200);
    });

    it('rejects a suspended account with 403 ACCOUNT_DISABLED', async () => {
      const user = await registerUser(t);
      await t.dataSource.query(
        `UPDATE users SET status = 'SUSPENDED' WHERE id = $1`,
        [user.id],
      );
      const res = await t
        .http()
        .post(t.api('/auth/login'))
        .send({ email: user.email, password: user.password })
        .expect(403);
      expect(res.body.code).toBe('ACCOUNT_DISABLED');
    });
  });

  describe('guard', () => {
    it('protected routes need a valid access token', async () => {
      const none = await t.http().post(t.api('/auth/logout')).expect(401);
      expect(none.body.code).toBe('UNAUTHORIZED');
      await t
        .http()
        .post(t.api('/auth/logout'))
        .set(bearer('not-a-jwt'))
        .expect(401);
    });

    it('a refresh token is not accepted as an access token', async () => {
      const user = await registerUser(t);
      await t
        .http()
        .post(t.api('/auth/logout'))
        .set(bearer(user.refreshToken))
        .expect(401);
    });
  });

  describe('refresh rotation (T2)', () => {
    it('issues a new pair; the old refresh token then counts as reuse and kills the session', async () => {
      const user = await registerUser(t);

      const first = await t
        .http()
        .post(t.api('/auth/refresh'))
        .send({ refreshToken: user.refreshToken })
        .expect(200);
      expect(first.body.refreshToken).not.toBe(user.refreshToken);
      expect(first.body.accessToken).not.toBe(user.accessToken);

      // the new refresh token works once more
      await t
        .http()
        .post(t.api('/auth/refresh'))
        .send({ refreshToken: first.body.refreshToken })
        .expect(200)
        .then(async (second) => {
          // re-using an old refresh token → reuse detected, session revoked
          const reuse = await t
            .http()
            .post(t.api('/auth/refresh'))
            .send({ refreshToken: first.body.refreshToken })
            .expect(401);
          expect(reuse.body.code).toBe('REFRESH_TOKEN_REUSED');

          // even the newest tokens of that session are dead now
          const latest = await t
            .http()
            .post(t.api('/auth/refresh'))
            .send({ refreshToken: second.body.refreshToken })
            .expect(401);
          expect(latest.body.code).toBe('REFRESH_TOKEN_INVALID');
          await t
            .http()
            .post(t.api('/auth/logout'))
            .set(bearer(second.body.accessToken))
            .expect(401);
        });
    });

    it('rejects garbage and access tokens with REFRESH_TOKEN_INVALID', async () => {
      const user = await registerUser(t);
      for (const refreshToken of ['garbage', user.accessToken]) {
        const res = await t
          .http()
          .post(t.api('/auth/refresh'))
          .send({ refreshToken })
          .expect(401);
        expect(res.body.code).toBe('REFRESH_TOKEN_INVALID');
      }
    });

    it('only one of two concurrent refreshes with the same token wins', async () => {
      const user = await registerUser(t);
      const results = await Promise.all(
        [1, 2].map(() =>
          t
            .http()
            .post(t.api('/auth/refresh'))
            .send({ refreshToken: user.refreshToken }),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 401]);
    });
  });

  describe('logout (T3)', () => {
    it('revokes the session: its access and refresh tokens stop working', async () => {
      const user = await registerUser(t);
      await t
        .http()
        .post(t.api('/auth/logout'))
        .set(bearer(user.accessToken))
        .expect(204);

      const again = await t
        .http()
        .post(t.api('/auth/logout'))
        .set(bearer(user.accessToken))
        .expect(401);
      expect(again.body.code).toBe('UNAUTHORIZED');

      const refresh = await t
        .http()
        .post(t.api('/auth/refresh'))
        .send({ refreshToken: user.refreshToken })
        .expect(401);
      expect(refresh.body.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('logout-all revokes every device', async () => {
      const user = await registerUser(t);
      const other = await login(t, user.email, user.password);
      await t
        .http()
        .post(t.api('/auth/logout-all'))
        .set(bearer(other.accessToken))
        .expect(204);
      for (const token of [user.accessToken, other.accessToken]) {
        await t
          .http()
          .post(t.api('/auth/logout'))
          .set(bearer(token))
          .expect(401);
      }
      const [row] = await t.dataSource.query(
        `SELECT count(*)::int AS active FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
        [user.id],
      );
      expect(row.active).toBe(0);
    });
  });
});

describe('Auth rate limit (e2e)', () => {
  let t: TestContext;
  const original = process.env.LOGIN_RATE_LIMIT_PER_MINUTE;

  beforeAll(async () => {
    process.env.LOGIN_RATE_LIMIT_PER_MINUTE = '3';
    t = await createTestApp();
  });

  afterAll(async () => {
    process.env.LOGIN_RATE_LIMIT_PER_MINUTE = original;
    await t.close();
  });

  it('limits login attempts per IP with 429 RATE_LIMITED', async () => {
    const attempt = () =>
      t
        .http()
        .post(t.api('/auth/login'))
        .send({ email: DEMO.alice, password: 'Wrong123!' });
    for (let i = 0; i < 3; i++) {
      await attempt().expect(401);
    }
    const blocked = await attempt().expect(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');

    // other routes are not affected by the login limit
    await t.http().get(t.api('/health')).expect(200);
  });
});
