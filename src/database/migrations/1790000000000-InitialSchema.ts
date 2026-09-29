import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The 9 tables, 5 enums, indexes, checks and foreign keys from docs/ERD.md.
 * Needs PostgreSQL 13+ (gen_random_uuid() is built in).
 */
export class InitialSchema1790000000000 implements MigrationInterface {
  name = 'InitialSchema1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // enums
    await queryRunner.query(
      `CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'SUSPENDED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."plan_code" AS ENUM('FREE', 'PREMIUM')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."provider_type" AS ENUM('OPENAI', 'ANTHROPIC', 'GEMINI', 'MOCK')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."health_status" AS ENUM('UNKNOWN', 'UP', 'DOWN')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."message_role" AS ENUM('USER', 'ASSISTANT')`,
    );

    // roles
    await queryRunner.query(
      `CREATE TABLE "roles" ("id" smallint NOT NULL, "name" character varying(20) NOT NULL, CONSTRAINT "uq_roles_name" UNIQUE ("name"), CONSTRAINT "pk_roles" PRIMARY KEY ("id"))`,
    );

    // users
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email" character varying(254) NOT NULL, "password_hash" character varying(100) NOT NULL, "full_name" character varying(80) NOT NULL, "avatar_url" character varying(500), "role_id" smallint NOT NULL, "status" "public"."user_status" NOT NULL DEFAULT 'ACTIVE', "is_email_verified" boolean NOT NULL DEFAULT false, "email_verify_token_hash" character varying(64), "email_verify_expires_at" TIMESTAMP WITH TIME ZONE, "last_login_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "pk_users" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email") WHERE "deleted_at" IS NULL`,
    );

    // sessions
    await queryRunner.query(
      `CREATE TABLE "sessions" ("id" uuid NOT NULL, "user_id" uuid NOT NULL, "refresh_token_hash" character varying(64) NOT NULL, "user_agent" character varying(500), "ip_address" character varying(64), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "pk_sessions" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_sessions_user" ON "sessions" ("user_id") WHERE "revoked_at" IS NULL`,
    );

    // subscriptions (plan + today's usage counter)
    await queryRunner.query(
      `CREATE TABLE "subscriptions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "plan" "public"."plan_code" NOT NULL DEFAULT 'FREE', "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "usage_date" date NOT NULL DEFAULT ('now'::text)::date, "requests_used" integer NOT NULL DEFAULT 0, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ck_subscriptions_requests_used" CHECK ("requests_used" >= 0), CONSTRAINT "pk_subscriptions" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_subscriptions_user" ON "subscriptions" ("user_id")`,
    );

    // ai_providers
    await queryRunner.query(
      `CREATE TABLE "ai_providers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(50) NOT NULL, "type" "public"."provider_type" NOT NULL, "model" character varying(100) NOT NULL, "api_key_encrypted" text, "api_key_last4" character varying(4), "is_enabled" boolean NOT NULL DEFAULT true, "is_default" boolean NOT NULL DEFAULT false, "health" "public"."health_status" NOT NULL DEFAULT 'UNKNOWN', "health_checked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_ai_providers_name" UNIQUE ("name"), CONSTRAINT "ck_ai_providers_default_enabled" CHECK (NOT "is_default" OR "is_enabled"), CONSTRAINT "pk_ai_providers" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_ai_providers_default" ON "ai_providers" ("is_default") WHERE "is_default"`,
    );

    // conversations + chat_messages
    await queryRunner.query(
      `CREATE TABLE "conversations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "title" character varying(100) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "pk_conversations" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_conversations_user" ON "conversations" ("user_id", "updated_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE TABLE "chat_messages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "conversation_id" uuid NOT NULL, "role" "public"."message_role" NOT NULL, "content" text NOT NULL, "provider_id" uuid, "latency_ms" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "pk_chat_messages" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_chat_messages_conversation" ON "chat_messages" ("conversation_id", "created_at")`,
    );

    // web_searches (history + cache)
    await queryRunner.query(
      `CREATE TABLE "web_searches" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "query" character varying(300) NOT NULL, "normalized_query" character varying(300) NOT NULL, "provider_id" uuid, "answer" text NOT NULL, "results" jsonb NOT NULL, "from_cache" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "pk_web_searches" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_web_searches_user" ON "web_searches" ("user_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_web_searches_cache" ON "web_searches" ("normalized_query", "provider_id", "created_at" DESC)`,
    );

    // api_usage_logs (request logs + AI usage analytics)
    await queryRunner.query(
      `CREATE TABLE "api_usage_logs" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "user_id" uuid, "method" character varying(10) NOT NULL, "path" character varying(500) NOT NULL, "status_code" smallint NOT NULL, "duration_ms" integer NOT NULL, "ip_address" character varying(64), "feature" character varying(20), "provider_id" uuid, "ai_success" boolean, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "pk_api_usage_logs" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_api_usage_logs_created" ON "api_usage_logs" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_api_usage_logs_feature" ON "api_usage_logs" ("feature", "created_at") WHERE "feature" IS NOT NULL`,
    );

    // foreign keys (ERD §5)
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "fk_users_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD CONSTRAINT "fk_sessions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD CONSTRAINT "fk_subscriptions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "fk_conversations_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_messages" ADD CONSTRAINT "fk_chat_messages_conversation" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "chat_messages" ADD CONSTRAINT "fk_chat_messages_provider" FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "web_searches" ADD CONSTRAINT "fk_web_searches_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "web_searches" ADD CONSTRAINT "fk_web_searches_provider" FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "api_usage_logs" ADD CONSTRAINT "fk_api_usage_logs_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "api_usage_logs" ADD CONSTRAINT "fk_api_usage_logs_provider" FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "api_usage_logs"`);
    await queryRunner.query(`DROP TABLE "web_searches"`);
    await queryRunner.query(`DROP TABLE "chat_messages"`);
    await queryRunner.query(`DROP TABLE "conversations"`);
    await queryRunner.query(`DROP TABLE "ai_providers"`);
    await queryRunner.query(`DROP TABLE "subscriptions"`);
    await queryRunner.query(`DROP TABLE "sessions"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(`DROP TYPE "public"."message_role"`);
    await queryRunner.query(`DROP TYPE "public"."health_status"`);
    await queryRunner.query(`DROP TYPE "public"."provider_type"`);
    await queryRunner.query(`DROP TYPE "public"."plan_code"`);
    await queryRunner.query(`DROP TYPE "public"."user_status"`);
  }
}
