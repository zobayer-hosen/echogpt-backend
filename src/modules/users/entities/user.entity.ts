import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { Role } from './role.entity';

@Entity('users')
@Index('uq_users_email', ['email'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class User {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_users' })
  id: string;

  /** Always stored lowercase. */
  @Column({ type: 'varchar', length: 254 })
  email: string;

  /** bcrypt hash; never selected unless asked for explicitly. */
  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 100,
    select: false,
  })
  passwordHash: string;

  @Column({ name: 'full_name', type: 'varchar', length: 80 })
  fullName: string;

  @Column({ name: 'avatar_url', type: 'varchar', length: 500, nullable: true })
  avatarUrl: string | null;

  @ManyToOne(() => Role, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'role_id', foreignKeyConstraintName: 'fk_users_role' })
  role: Role;

  @Column({ name: 'role_id', type: 'smallint' })
  roleId: number;

  @Column({
    type: 'enum',
    enum: UserStatus,
    enumName: 'user_status',
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  @Column({ name: 'is_email_verified', type: 'boolean', default: false })
  isEmailVerified: boolean;

  @Column({
    name: 'email_verify_token_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
    select: false,
  })
  emailVerifyTokenHash: string | null;

  @Column({
    name: 'email_verify_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  emailVerifyExpiresAt: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
