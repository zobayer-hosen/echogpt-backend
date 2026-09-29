import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MessageRole } from '../../../common/enums/message-role.enum';
import { AiProvider } from '../../providers/entities/ai-provider.entity';
import { Conversation } from './conversation.entity';

@Entity('chat_messages')
@Index('ix_chat_messages_conversation', ['conversationId', 'createdAt'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_chat_messages',
  })
  id: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({
    name: 'conversation_id',
    foreignKeyConstraintName: 'fk_chat_messages_conversation',
  })
  conversation: Conversation;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ type: 'enum', enum: MessageRole, enumName: 'message_role' })
  role: MessageRole;

  @Column({ type: 'text' })
  content: string;

  /** Filled only for ASSISTANT messages. */
  @ManyToOne(() => AiProvider, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'provider_id',
    foreignKeyConstraintName: 'fk_chat_messages_provider',
  })
  provider: AiProvider | null;

  @Column({ name: 'provider_id', type: 'uuid', nullable: true })
  providerId: string | null;

  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  latencyMs: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
