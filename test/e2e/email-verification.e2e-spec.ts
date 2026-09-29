import { sha256 } from '../../src/common/utils/crypto.util';
import { MailService } from '../../src/modules/auth/mail.service';
import { bearer, login, registerUser, TestUser } from '../setup/factories';
import { createTestApp, TestContext } from '../setup/test-app';

describe('Email verification (e2e, bonus AU-7)', () => {
  let t: TestContext;
  let mailSpy: jest.SpyInstance;

  /** the token from the last "sent" email */
  const lastToken = (): string =>
    mailSpy.mock.calls[mailSpy.mock.calls.length - 1][1] as string;
  const verify = (token: string) =>
    t.http().post(t.api('/auth/verify-email')).send({ token });
  const resend = (user: TestUser) =>
    t
      .http()
      .post(t.api('/auth/resend-verification'))
      .set(bearer(user.accessToken));
  const profile = async (user: TestUser) =>
    (await t.http().get(t.api('/users/me')).set(bearer(user.accessToken))).body;
  /** pretend the last email was sent `seconds` ago */
  const ageLastEmail = (user: TestUser, seconds: number) =>
    t.dataSource.query(
      `UPDATE users SET email_verify_expires_at = email_verify_expires_at - make_interval(secs => $2) WHERE id = $1`,
      [user.id, seconds],
    );

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(() => {
    mailSpy = jest
      .spyOn(MailService.prototype, 'sendVerificationEmail')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await t.close();
  });

  it('register sends a token; verifying it marks the email verified once', async () => {
    const user = await registerUser(t);
    expect(mailSpy).toHaveBeenCalledTimes(1);
    const [to, token, expiresAt] = mailSpy.mock.calls[0] as [
      string,
      string,
      Date,
    ];
    expect(to).toBe(user.email);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(
      23.9 * 3600 * 1000,
    );

    // stored hashed, never in clear
    const [row] = await t.dataSource.query(
      `SELECT email_verify_token_hash FROM users WHERE id = $1`,
      [user.id],
    );
    expect(row.email_verify_token_hash).toBe(sha256(token));
    expect(await profile(user)).toMatchObject({ isEmailVerified: false });

    const res = await verify(token).expect(200);
    expect(res.body).toEqual({ email: user.email, isEmailVerified: true });
    expect(await profile(user)).toMatchObject({ isEmailVerified: true });

    const again = await verify(token).expect(400);
    expect(again.body.code).toBe('EMAIL_TOKEN_INVALID');
  });

  it('rejects unknown and expired tokens', async () => {
    await verify('x'.repeat(43)).expect(400);
    await verify('short').expect(400);

    const user = await registerUser(t);
    const token = lastToken();
    await t.dataSource.query(
      `UPDATE users SET email_verify_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [user.id],
    );
    const res = await verify(token).expect(400);
    expect(res.body.code).toBe('EMAIL_TOKEN_INVALID');
  });

  it('resend: at most once per minute, and the old token stops working', async () => {
    const user = await registerUser(t);
    const first = lastToken();

    const tooSoon = await resend(user).expect(429);
    expect(tooSoon.body).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: expect.any(Number) },
    });

    await ageLastEmail(user, 61);
    const res = await resend(user).expect(202);
    expect(res.body).toEqual({
      email: user.email,
      expiresAt: expect.any(String),
    });
    const second = lastToken();
    expect(second).not.toBe(first);

    await verify(first).expect(400);
    await verify(second).expect(200);
  });

  it('resend is 409 once verified, and needs a login', async () => {
    const user = await registerUser(t);
    await verify(lastToken()).expect(200);
    await ageLastEmail(user, 61);
    const res = await resend(user).expect(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_VERIFIED');
    await t.http().post(t.api('/auth/resend-verification')).expect(401);
  });

  it('an unverified user can still use the API (PRD A9)', async () => {
    const user = await registerUser(t);
    const session = await login(t, user.email, user.password);
    await t
      .http()
      .post(t.api('/chat/messages'))
      .set(bearer(session.accessToken))
      .send({ prompt: 'hello' })
      .expect(201);
  });
});
