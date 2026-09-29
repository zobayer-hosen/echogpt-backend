import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { HealthStatus } from '../../../common/enums/health-status.enum';
import { ProviderType } from '../../../common/enums/provider-type.enum';

@Entity('ai_providers')
@Unique('uq_ai_providers_name', ['name'])
@Index('uq_ai_providers_default', ['isDefault'], {
  unique: true,
  where: '"is_default"',
})
@Check('ck_ai_providers_default_enabled', 'NOT "is_default" OR "is_enabled"')
export class AiProvider {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_ai_providers',
  })
  id: string;

  @Column({ type: 'varchar', length: 50 })
  name: string;

  @Column({ type: 'enum', enum: ProviderType, enumName: 'provider_type' })
  type: ProviderType;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  /** AES-256-GCM `iv:authTag:ciphertext` (base64). Never selected by default. */
  @Column({
    name: 'api_key_encrypted',
    type: 'text',
    nullable: true,
    select: false,
  })
  apiKeyEncrypted: string | null;

  @Column({ name: 'api_key_last4', type: 'varchar', length: 4, nullable: true })
  apiKeyLast4: string | null;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled: boolean;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @Column({
    name: 'health',
    type: 'enum',
    enum: HealthStatus,
    enumName: 'health_status',
    default: HealthStatus.UNKNOWN,
  })
  healthStatus: HealthStatus;

  @Column({ name: 'health_checked_at', type: 'timestamptz', nullable: true })
  healthCheckedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
