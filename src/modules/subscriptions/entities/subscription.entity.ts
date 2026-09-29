import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PlanCode } from '../../../common/enums/plan-code.enum';
import { User } from '../../users/entities/user.entity';

/** A user's plan plus today's usage counter (one row per user). */
@Entity('subscriptions')
@Check('ck_subscriptions_requests_used', '"requests_used" >= 0')
@Index('uq_subscriptions_user', ['userId'], { unique: true })
export class Subscription {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_subscriptions',
  })
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_subscriptions_user',
  })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    type: 'enum',
    enum: PlanCode,
    enumName: 'plan_code',
    default: PlanCode.FREE,
  })
  plan: PlanCode;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  /** UTC day the counter belongs to (`YYYY-MM-DD`). */
  @Column({ name: 'usage_date', type: 'date', default: () => 'CURRENT_DATE' })
  usageDate: string;

  @Column({ name: 'requests_used', type: 'int', default: 0 })
  requestsUsed: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
