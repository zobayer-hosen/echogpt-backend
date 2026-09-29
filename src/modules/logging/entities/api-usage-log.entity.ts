import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UsageFeature } from '../../../common/enums/usage-feature.enum';
import { AiProvider } from '../../providers/entities/ai-provider.entity';
import { User } from '../../users/entities/user.entity';

/** One row per HTTP request; AI fields are set when an AI provider was called. */
@Entity('api_usage_logs')
@Index('ix_api_usage_logs_created', ['createdAt'])
@Index('ix_api_usage_logs_feature', ['feature', 'createdAt'], {
  where: '"feature" IS NOT NULL',
})
export class ApiUsageLog {
  /** bigint identity, returned by pg as a string */
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
    primaryKeyConstraintName: 'pk_api_usage_logs',
  })
  id: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_api_usage_logs_user',
  })
  user: User | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 10 })
  method: string;

  @Column({ type: 'varchar', length: 500 })
  path: string;

  @Column({ name: 'status_code', type: 'smallint' })
  statusCode: number;

  @Column({ name: 'duration_ms', type: 'int' })
  durationMs: number;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  feature: UsageFeature | null;

  @ManyToOne(() => AiProvider, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'provider_id',
    foreignKeyConstraintName: 'fk_api_usage_logs_provider',
  })
  provider: AiProvider | null;

  @Column({ name: 'provider_id', type: 'uuid', nullable: true })
  providerId: string | null;

  @Column({ name: 'ai_success', type: 'boolean', nullable: true })
  aiSuccess: boolean | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
