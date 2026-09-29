import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Session } from '../modules/auth/entities/session.entity';
import { ChatMessage } from '../modules/chat/entities/chat-message.entity';
import { Conversation } from '../modules/chat/entities/conversation.entity';
import { ApiUsageLog } from '../modules/logging/entities/api-usage-log.entity';
import { AiProvider } from '../modules/providers/entities/ai-provider.entity';
import { WebSearch } from '../modules/search/entities/web-search.entity';
import { Subscription } from '../modules/subscriptions/entities/subscription.entity';
import { Role } from '../modules/users/entities/role.entity';
import { User } from '../modules/users/entities/user.entity';
import { InitialSchema1790000000000 } from './migrations/1790000000000-InitialSchema';

/** All 9 tables (ERD). */
export const ENTITIES = [
  Role,
  User,
  Session,
  Subscription,
  AiProvider,
  Conversation,
  ChatMessage,
  WebSearch,
  ApiUsageLog,
];

/** Listed explicitly so the app, the CLI and the tests run the same set. */
export const MIGRATIONS = [InitialSchema1790000000000];

/** Shared by the Nest app and the TypeORM CLI. Schema changes only via migrations. */
export function buildDataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    migrationsTableName: 'migrations',
    synchronize: false,
    // gen_random_uuid() is built into PostgreSQL 13+, no extension needed
    uuidExtension: 'pgcrypto',
    installExtensions: false,
    // "today" for usage counters is the UTC day
    extra: { options: '-c timezone=UTC' },
  };
}

loadEnv();

/** Used by the TypeORM CLI (`npm run migration:run`) and the seed script. */
export default new DataSource(
  buildDataSourceOptions(process.env.DATABASE_URL ?? ''),
);
