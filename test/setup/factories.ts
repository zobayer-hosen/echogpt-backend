import { DEMO_PASSWORD } from '../../src/database/seeds/seed';
import { TestContext } from './test-app';

export const DEMO = {
  admin: 'admin@echogpt.dev',
  alice: 'alice@echogpt.dev',
  bob: 'bob@echogpt.dev',
  password: DEMO_PASSWORD,
};

let counter = 0;

/** A fresh email per call, so tests never collide. */
export const uniqueEmail = (prefix = 'user'): string =>
  `${prefix}.${Date.now()}.${counter++}@test.dev`;

export const bearer = (token: string) => ({
  Authorization: `Bearer ${token}`,
});

export interface TestUser {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
}

/** Registers a new FREE user through the API. */
export async function registerUser(
  t: TestContext,
  overrides: Partial<{
    email: string;
    password: string;
    fullName: string;
  }> = {},
): Promise<TestUser> {
  const body = {
    email: overrides.email ?? uniqueEmail(),
    password: overrides.password ?? 'Secret123!',
    fullName: overrides.fullName ?? 'Test User',
  };
  const res = await t
    .http()
    .post(t.api('/auth/register'))
    .send(body)
    .expect(201);
  return {
    id: res.body.user.id,
    email: body.email,
    password: body.password,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
}

/** Logs in through the API and returns the tokens. */
export async function login(
  t: TestContext,
  email: string,
  password = DEMO_PASSWORD,
): Promise<{ id: string; accessToken: string; refreshToken: string }> {
  const res = await t
    .http()
    .post(t.api('/auth/login'))
    .send({ email, password })
    .expect(200);
  return {
    id: res.body.user.id,
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
}
