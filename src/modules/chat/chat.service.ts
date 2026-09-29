import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-codes';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { MessageRole } from '../../common/enums/message-role.enum';
import { UsageFeature } from '../../common/enums/usage-feature.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { pageOffset, toPage } from '../../common/utils/pagination.util';
import { RequestContext } from '../../common/utils/request-context';
import { conversationTitle } from '../../common/utils/text.util';
import {
  ChatResult,
  ChatTurn,
} from '../providers/adapters/ai-provider-adapter.interface';
import { ProvidersService } from '../providers/providers.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  ChatMessageDto,
  ChatReplyDto,
  ConversationDetailDto,
  ConversationDto,
  SendMessageDto,
} from './dto/chat.dto';
import { ChatMessage } from './entities/chat-message.entity';
import { Conversation } from './entities/conversation.entity';

export type ChatStreamEvent =
  | { event: 'token'; data: { text: string } }
  | { event: 'done'; data: ChatReplyDto }
  | { event: 'error'; data: { code: string; message: string } };

/** Error frame for a failure after streaming started (no stack, no secrets). */
function toStreamError(error: unknown): { code: string; message: string } {
  if (error instanceof AppException) {
    return { code: String(error.code), message: error.message };
  }
  return { code: ErrorCode.INTERNAL_ERROR, message: 'Internal server error' };
}

/** Messages sent to the provider as context (PRD CH-2). */
export const HISTORY_SIZE = 20;
const DEFAULT_TITLE = 'New chat';

/** Owns `conversations` and `chat_messages`. */
@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(ChatMessage)
    private readonly messages: Repository<ChatMessage>,
    private readonly dataSource: DataSource,
    private readonly providers: ProvidersService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * PRD CH-2 order: ownership → provider → count usage → last 20 messages →
   * call provider → save USER + ASSISTANT in one transaction → log → return.
   * A failed AI call gives the request back (PRD A8).
   * `conversationId = null` starts a new conversation (POST /chat/messages).
   */
  async sendMessage(
    userId: string,
    conversationId: string | null,
    dto: SendMessageDto,
  ): Promise<ChatReplyDto> {
    const existing = conversationId
      ? await this.findOwned(userId, conversationId)
      : null;
    const { provider, adapter } = await this.providers.resolveForUse(
      dto.providerId,
    );
    const usage = await this.subscriptions.useRequest(userId);
    const history = existing ? await this.history(existing.id) : [];
    const sentAt = new Date();

    let answer: ChatResult;
    try {
      answer = await adapter.chat([
        ...history,
        { role: 'user', content: dto.prompt },
      ]);
    } catch (error) {
      await this.subscriptions.giveBackRequest(userId);
      RequestContext.setAiCall({
        feature: UsageFeature.CHAT,
        providerId: provider.id,
        success: false,
      });
      throw error;
    }
    RequestContext.setAiCall({
      feature: UsageFeature.CHAT,
      providerId: provider.id,
      success: true,
    });

    const saved = await this.saveExchange({
      userId,
      existing,
      isFirstMessage: !history.length,
      prompt: dto.prompt,
      sentAt,
      providerId: provider.id,
      answer,
    });

    return {
      conversation: this.toConversation(saved.conversation),
      userMessage: this.toMessage(saved.userMessage),
      assistantMessage: this.toMessage(saved.assistantMessage),
      usage,
    };
  }

  /**
   * Streaming variant (PRD CH-5). Ownership, provider and usage are checked
   * first, so those errors are normal JSON responses. The returned events are
   * then streamed: `token` pieces, and `done` after both messages are saved,
   * or `error` (request given back, nothing saved). If the client
   * disconnects, the provider call stops and nothing is saved.
   */
  async streamMessage(
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
    signal: AbortSignal,
  ): Promise<AsyncGenerator<ChatStreamEvent>> {
    const existing = await this.findOwned(userId, conversationId);
    const { provider, adapter } = await this.providers.resolveForUse(
      dto.providerId,
    );
    const usage = await this.subscriptions.useRequest(userId);
    const history = await this.history(existing.id);
    const sentAt = new Date();
    const logCall = (success: boolean) =>
      RequestContext.setAiCall({
        feature: UsageFeature.CHAT,
        providerId: provider.id,
        success,
      });

    return async function* (this: ChatService) {
      let content = '';
      try {
        const turns: ChatTurn[] = [
          ...history,
          { role: 'user', content: dto.prompt },
        ];
        for await (const text of adapter.chatStream(turns, signal)) {
          content += text;
          yield { event: 'token', data: { text } } as const;
        }
        if (!content) {
          throw new AppException(
            HttpStatus.BAD_GATEWAY,
            ErrorCode.PROVIDER_ERROR,
            `${provider.name} returned an empty answer`,
          );
        }
      } catch (error) {
        logCall(false);
        if (signal.aborted) {
          return; // the client left; nothing to send or save
        }
        await this.subscriptions.giveBackRequest(userId);
        yield { event: 'error', data: toStreamError(error) } as const;
        return;
      }
      logCall(true);

      const saved = await this.saveExchange({
        userId,
        existing,
        isFirstMessage: !history.length,
        prompt: dto.prompt,
        sentAt,
        providerId: provider.id,
        answer: { content, latencyMs: Date.now() - sentAt.getTime() },
      });
      yield {
        event: 'done',
        data: {
          conversation: this.toConversation(saved.conversation),
          userMessage: this.toMessage(saved.userMessage),
          assistantMessage: this.toMessage(saved.assistantMessage),
          usage,
        },
      } as const;
    }.call(this);
  }

  async create(userId: string, title?: string): Promise<ConversationDto> {
    const conversation = await this.conversations.save(
      this.conversations.create({ userId, title: title ?? DEFAULT_TITLE }),
    );
    return this.toConversation(conversation);
  }

  /** Newest first (PRD CH-4). */
  async list(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<ConversationDto>> {
    const [rows, total] = await this.conversations.findAndCount({
      where: { userId },
      order: { updatedAt: 'DESC', id: 'ASC' },
      skip: pageOffset(query),
      take: query.limit,
    });
    return toPage(
      rows.map((c) => this.toConversation(c)),
      total,
      query,
    );
  }

  async get(userId: string, id: string): Promise<ConversationDetailDto> {
    const conversation = await this.findOwned(userId, id);
    const messages = await this.messages
      .createQueryBuilder('m')
      .where('m.conversation_id = :id', { id })
      // USER sorts before ASSISTANT (enum order) if timestamps tie
      .orderBy('m.created_at', 'ASC')
      .addOrderBy('m.role', 'ASC')
      .getMany();
    return {
      ...this.toConversation(conversation),
      messages: messages.map((m) => this.toMessage(m)),
    };
  }

  async rename(
    userId: string,
    id: string,
    title: string,
  ): Promise<ConversationDto> {
    const conversation = await this.findOwned(userId, id);
    conversation.title = title;
    return this.toConversation(await this.conversations.save(conversation));
  }

  /** Soft delete; messages stay for analytics (PRD CH-4). */
  async remove(userId: string, id: string): Promise<void> {
    await this.findOwned(userId, id);
    await this.conversations.softDelete({ id });
  }

  /** Prompts sent today (UTC), for the admin dashboard. */
  async countPromptsToday(): Promise<number> {
    return this.messages
      .createQueryBuilder('m')
      .where('m.role = :role', { role: MessageRole.USER })
      .andWhere('m.created_at >= CURRENT_DATE')
      .getCount();
  }

  /** Another user's (or a deleted) conversation is 404, never 403. */
  async findOwned(userId: string, id: string): Promise<Conversation> {
    const conversation = await this.conversations.findOne({
      where: { id, userId },
    });
    if (!conversation) {
      throw AppException.notFound('Conversation');
    }
    return conversation;
  }

  /** The last HISTORY_SIZE messages, oldest first, as provider turns. */
  async history(conversationId: string): Promise<ChatTurn[]> {
    const latest = await this.messages
      .createQueryBuilder('m')
      .where('m.conversation_id = :conversationId', { conversationId })
      .orderBy('m.created_at', 'DESC')
      .addOrderBy('m.role', 'DESC')
      .limit(HISTORY_SIZE)
      .getMany();
    return latest.reverse().map((m) => ({
      role: m.role === MessageRole.USER ? 'user' : 'assistant',
      content: m.content,
    }));
  }

  /** USER + ASSISTANT messages in one transaction (PRD §9 data integrity). */
  private saveExchange(input: {
    userId: string;
    existing: Conversation | null;
    isFirstMessage: boolean;
    prompt: string;
    sentAt: Date;
    providerId: string;
    answer: ChatResult;
  }) {
    const { existing, prompt, sentAt, answer } = input;
    return this.dataSource.transaction(async (m) => {
      const conversation =
        existing ?? (await this.createIn(m, input.userId, prompt));
      const title =
        existing && existing.title === DEFAULT_TITLE && input.isFirstMessage
          ? conversationTitle(prompt)
          : conversation.title;
      const userMessage = await m.save(
        m.create(ChatMessage, {
          conversationId: conversation.id,
          role: MessageRole.USER,
          content: prompt,
          providerId: null,
          latencyMs: null,
          createdAt: sentAt,
        }),
      );
      const assistantMessage = await m.save(
        m.create(ChatMessage, {
          conversationId: conversation.id,
          role: MessageRole.ASSISTANT,
          content: answer.content,
          providerId: input.providerId,
          latencyMs: answer.latencyMs,
          createdAt: new Date(Math.max(Date.now(), sentAt.getTime() + 1)),
        }),
      );
      // any UPDATE also sets updated_at, moving it to the top of the list
      await m.update(Conversation, { id: conversation.id }, { title });
      return {
        conversation: await m.findOneByOrFail(Conversation, {
          id: conversation.id,
        }),
        userMessage,
        assistantMessage,
      };
    });
  }

  private createIn(
    m: EntityManager,
    userId: string,
    prompt: string,
  ): Promise<Conversation> {
    return m.save(
      m.create(Conversation, { userId, title: conversationTitle(prompt) }),
    );
  }

  private toConversation(c: Conversation): ConversationDto {
    return {
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  private toMessage(m: ChatMessage): ChatMessageDto {
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      providerId: m.providerId,
      latencyMs: m.latencyMs,
      createdAt: m.createdAt,
    };
  }
}
