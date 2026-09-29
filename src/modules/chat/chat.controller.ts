import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  ApiError,
  ApiErrorResponses,
} from '../../common/decorators/api-error-responses.decorator';
import { ApiPaginatedResponse } from '../../common/decorators/api-paginated-response.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BEARER_AUTH } from '../../config/swagger.config';
import { ChatService } from './chat.service';
import {
  ChatReplyDto,
  ConversationDetailDto,
  ConversationDto,
  CreateConversationDto,
  RenameConversationDto,
  SendMessageDto,
} from './dto/chat.dto';

const CONVERSATION = {
  id: '7c1d3f5e-2a4b-4c6d-8e0f-1a2b3c4d5e6f',
  title: 'Summarize the main points of this article in 3',
  createdAt: '2026-09-29T10:15:00.000Z',
  updatedAt: '2026-09-29T10:16:00.000Z',
};

const USER_MESSAGE = {
  id: '0b8e6a2c-4d1f-4e3a-9b7c-5d6e7f8a9b0c',
  role: 'USER',
  content: 'Summarize the main points of this article in 3 bullets.',
  providerId: null,
  latencyMs: null,
  createdAt: '2026-09-29T10:16:00.000Z',
};

const ASSISTANT_MESSAGE = {
  id: '1c9f7b3d-5e2a-4f4b-8c8d-6e7f8a9b0c1d',
  role: 'ASSISTANT',
  content: '• Point one\n• Point two\n• Point three',
  providerId: '9b2f0c1e-6d7a-4c1b-8e2f-0a1b2c3d4e5f',
  latencyMs: 842,
  createdAt: '2026-09-29T10:16:01.000Z',
};

const REPLY = {
  conversation: CONVERSATION,
  userMessage: USER_MESSAGE,
  assistantMessage: ASSISTANT_MESSAGE,
  usage: {
    plan: 'FREE',
    limit: 20,
    used: 8,
    remaining: 12,
    resetsAt: '2026-09-30T00:00:00.000Z',
  },
};

const CONVERSATION_ID = ApiParam({
  name: 'id',
  format: 'uuid',
  example: CONVERSATION.id,
});

const UUID_ERROR = ApiError.validation({
  id: ['Validation failed (uuid is expected)'],
});

/** Errors of a request that calls an AI provider (PRD §7). */
const AI_CALL_ERRORS = [
  ApiError.validation({
    prompt: ['prompt must be longer than or equal to 1 characters'],
  }),
  ApiError.unauthorized,
  ApiError.notFound('Provider'),
  ApiError.custom(
    409,
    ErrorCode.PROVIDER_DISABLED,
    'Provider "OpenAI" is disabled',
  ),
  ApiError.custom(
    429,
    ErrorCode.USAGE_LIMIT_EXCEEDED,
    'Daily limit of 20 requests reached',
    {
      limit: 20,
      used: 20,
      remaining: 0,
      resetsAt: '2026-09-30T00:00:00.000Z',
    },
  ),
  ApiError.custom(502, ErrorCode.PROVIDER_ERROR, 'OpenAI returned HTTP 500'),
  ApiError.custom(
    504,
    ErrorCode.PROVIDER_TIMEOUT,
    'OpenAI did not answer within 30s',
  ),
];

@ApiTags('Chat')
@ApiBearerAuth(BEARER_AUTH)
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('messages')
  @ApiOperation({
    summary: 'Send a prompt in a new conversation',
    description:
      'Creates a conversation (titled from the prompt), asks the provider, saves both messages. Counts one request. A failed AI call does not count.',
  })
  @ApiCreatedResponse({ type: ChatReplyDto, example: REPLY })
  @ApiErrorResponses(...AI_CALL_ERRORS)
  startConversation(
    @CurrentUser() user: AuthUser,
    @Body() dto: SendMessageDto,
  ): Promise<ChatReplyDto> {
    return this.chat.sendMessage(user.id, null, dto);
  }

  @Post('conversations')
  @ApiOperation({
    summary: 'Create an empty conversation',
    description: 'Does not count as a request.',
  })
  @ApiCreatedResponse({
    type: ConversationDto,
    example: { ...CONVERSATION, title: 'Trip planning' },
  })
  @ApiErrorResponses(
    ApiError.validation({
      title: ['title must be longer than or equal to 1 characters'],
    }),
    ApiError.unauthorized,
  )
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateConversationDto,
  ): Promise<ConversationDto> {
    return this.chat.create(user.id, dto.title);
  }

  @Get('conversations')
  @ApiOperation({
    summary: 'List my conversations',
    description: 'Most recently active first, paginated.',
  })
  @ApiPaginatedResponse(ConversationDto)
  @ApiErrorResponses(
    ApiError.validation({ limit: ['limit must not be greater than 100'] }),
    ApiError.unauthorized,
  )
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<ConversationDto>> {
    return this.chat.list(user.id, query);
  }

  @Get('conversations/:id')
  @CONVERSATION_ID
  @ApiOperation({
    summary: 'Get a conversation with its messages',
    description: 'Messages oldest first. Another user’s conversation is 404.',
  })
  @ApiOkResponse({
    type: ConversationDetailDto,
    example: { ...CONVERSATION, messages: [USER_MESSAGE, ASSISTANT_MESSAGE] },
  })
  @ApiErrorResponses(
    UUID_ERROR,
    ApiError.unauthorized,
    ApiError.notFound('Conversation'),
  )
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationDetailDto> {
    return this.chat.get(user.id, id);
  }

  @Patch('conversations/:id')
  @CONVERSATION_ID
  @ApiOperation({ summary: 'Rename a conversation' })
  @ApiOkResponse({
    type: ConversationDto,
    example: { ...CONVERSATION, title: 'Trip planning (Rome)' },
  })
  @ApiErrorResponses(
    ApiError.validation({
      title: ['title must be longer than or equal to 1 characters'],
    }),
    ApiError.unauthorized,
    ApiError.notFound('Conversation'),
  )
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameConversationDto,
  ): Promise<ConversationDto> {
    return this.chat.rename(user.id, id, dto.title);
  }

  @Delete('conversations/:id')
  @CONVERSATION_ID
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a conversation',
    description: 'Soft delete: it disappears from your history.',
  })
  @ApiNoContentResponse({ description: 'Conversation deleted' })
  @ApiErrorResponses(
    UUID_ERROR,
    ApiError.unauthorized,
    ApiError.notFound('Conversation'),
  )
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.chat.remove(user.id, id);
  }

  @Post('conversations/:id/messages')
  @CONVERSATION_ID
  @ApiOperation({
    summary: 'Send a prompt in a conversation',
    description:
      'The last 20 messages go to the provider as context. Counts one request; a failed AI call does not count. `providerId` is optional (default provider).',
  })
  @ApiCreatedResponse({ type: ChatReplyDto, example: REPLY })
  @ApiErrorResponses(...AI_CALL_ERRORS, ApiError.notFound('Conversation'))
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ): Promise<ChatReplyDto> {
    return this.chat.sendMessage(user.id, id, dto);
  }
}
