import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AiProvider } from '../../providers/entities/ai-provider.entity';
import { User } from '../../users/entities/user.entity';

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

/** Search history and, within the TTL, the search cache. */
@Entity('web_searches')
// both indexes use created_at DESC and are created by the migration
@Index('ix_web_searches_user', { synchronize: false })
@Index('ix_web_searches_cache', { synchronize: false })
export class WebSearch {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_web_searches',
  })
  id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'fk_web_searches_user',
  })
  user: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** As typed. */
  @Column({ type: 'varchar', length: 300 })
  query: string;

  /** Lowercase, trimmed, single spaces. */
  @Column({ name: 'normalized_query', type: 'varchar', length: 300 })
  normalizedQuery: string;

  @ManyToOne(() => AiProvider, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'provider_id',
    foreignKeyConstraintName: 'fk_web_searches_provider',
  })
  provider: AiProvider | null;

  @Column({ name: 'provider_id', type: 'uuid', nullable: true })
  providerId: string | null;

  @Column({ type: 'text' })
  answer: string;

  @Column({ type: 'jsonb' })
  results: SearchResultItem[];

  @Column({ name: 'from_cache', type: 'boolean', default: false })
  fromCache: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
