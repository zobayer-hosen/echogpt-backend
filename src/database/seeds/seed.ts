import * as bcrypt from 'bcrypt';
import { DataSource, EntityManager } from 'typeorm';
import { PlanCode } from '../../common/enums/plan-code.enum';
import { ProviderType } from '../../common/enums/provider-type.enum';
import { ROLE_IDS, RoleName } from '../../common/enums/role-name.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import dataSource from '../data-source';
import { AiProvider } from '../../modules/providers/entities/ai-provider.entity';
import { Subscription } from '../../modules/subscriptions/entities/subscription.entity';
import { Role } from '../../modules/users/entities/role.entity';
import { User } from '../../modules/users/entities/user.entity';

/** Demo only; documented in the README. */
export const DEMO_PASSWORD = 'Password123!';

export const DEMO_USERS = [
  {
    email: 'admin@echogpt.dev',
    fullName: 'Ada Admin',
    role: RoleName.ADMIN,
    plan: PlanCode.PREMIUM,
  },
  {
    email: 'alice@echogpt.dev',
    fullName: 'Alice Free',
    role: RoleName.USER,
    plan: PlanCode.FREE,
  },
  {
    email: 'bob@echogpt.dev',
    fullName: 'Bob Premium',
    role: RoleName.USER,
    plan: PlanCode.PREMIUM,
  },
] as const;

/** Mock is the default so the API works without paid keys (PRD A1). */
export const DEMO_PROVIDERS = [
  { name: 'Mock AI', type: ProviderType.MOCK, model: 'mock-1', enabled: true },
  {
    name: 'OpenAI',
    type: ProviderType.OPENAI,
    model: 'gpt-4o-mini',
    enabled: false,
  },
  {
    name: 'Claude',
    type: ProviderType.ANTHROPIC,
    model: 'claude-haiku-4-5',
    enabled: false,
  },
  {
    name: 'Gemini',
    type: ProviderType.GEMINI,
    model: 'gemini-flash-latest',
    enabled: false,
  },
] as const;

export interface SeedSummary {
  roles: number;
  usersCreated: number;
  providersCreated: number;
}

async function seedRoles(m: EntityManager): Promise<void> {
  await m
    .createQueryBuilder()
    .insert()
    .into(Role)
    .values(
      Object.values(RoleName).map((name) => ({ id: ROLE_IDS[name], name })),
    )
    .orIgnore()
    .execute();
}

async function seedUsers(m: EntityManager): Promise<number> {
  let created = 0;
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const demo of DEMO_USERS) {
    const exists = await m.exists(User, { where: { email: demo.email } });
    if (exists) {
      continue;
    }
    const user = await m.save(
      m.create(User, {
        email: demo.email,
        passwordHash,
        fullName: demo.fullName,
        roleId: ROLE_IDS[demo.role],
        status: UserStatus.ACTIVE,
        isEmailVerified: true,
      }),
    );
    await m.save(m.create(Subscription, { userId: user.id, plan: demo.plan }));
    created++;
  }
  return created;
}

async function seedProviders(m: EntityManager): Promise<number> {
  let created = 0;
  for (const demo of DEMO_PROVIDERS) {
    const exists = await m.exists(AiProvider, { where: { name: demo.name } });
    if (exists) {
      continue;
    }
    await m.save(
      m.create(AiProvider, {
        name: demo.name,
        type: demo.type,
        model: demo.model,
        isEnabled: demo.enabled,
        isDefault: false,
      }),
    );
    created++;
  }
  // make Mock AI the default only if nothing is default yet
  const hasDefault = await m.exists(AiProvider, { where: { isDefault: true } });
  if (!hasDefault) {
    await m.update(
      AiProvider,
      { name: DEMO_PROVIDERS[0].name },
      { isDefault: true, isEnabled: true },
    );
  }
  return created;
}

/** Idempotent: safe to run many times; never overwrites existing rows. */
export async function runSeed(dataSource: DataSource): Promise<SeedSummary> {
  return dataSource.transaction(async (m) => {
    await seedRoles(m);
    const usersCreated = await seedUsers(m);
    const providersCreated = await seedProviders(m);
    return {
      roles: await m.count(Role),
      usersCreated,
      providersCreated,
    };
  });
}

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    const summary = await runSeed(dataSource);
    console.log(
      `Seed done: ${summary.roles} roles, ${summary.usersCreated} users created, ${summary.providersCreated} providers created`,
    );
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      'Seed failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    process.exit(1);
  });
}
