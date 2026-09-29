import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { MessageRole } from '../../../common/enums/message-role.enum';
import { trim } from '../../auth/dto/register.dto';
import { UsageDto } from '../../subscriptions/dto/subscription.dto';

export const MAX_PROMPT_LENGTH = 8000;

export class SendMessageDto {
  @ApiProperty({
    example: 'Summarize the main points of this article in 3 bullets.',
    minLength: 1,
    maxLength: MAX_PROMPT_LENGTH,
  })
  @Transform(trim)
  @IsString()
  @Length(1, MAX_PROMPT_LENGTH)
  prompt: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '9b2f0c1e-6d7a-4c1b-8e2f-0a1b2c3d4e5f',
    description: 'From GET /providers. Omit to use the default provider.',
  })
  @IsOptional()
  @IsUUID()
  providerId?: string;
}

export class CreateConversationDto {
  @ApiPropertyOptional({
    example: 'Trip planning',
    maxLength: 100,
    description:
      'Optional. Without it the first prompt (first 60 characters) becomes the title.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  title?: string;
}

export class RenameConversationDto {
  @ApiProperty({ example: 'Trip planning (Rome)', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  title: string;
}

export class ConversationDto {
  @ApiProperty({ example: '7c1d3f5e-2a4b-4c6d-8e0f-1a2b3c4d5e6f' })
  id: string;

  @ApiProperty({ example: 'Summarize the main points of this article in 3' })
  title: string;

  @ApiProperty({ example: '2026-09-29T10:15:00.000Z' })
  createdAt: Date;

  @ApiProperty({
    example: '2026-09-29T10:16:00.000Z',
    description: 'Time of the last message',
  })
  updatedAt: Date;
}

export class ChatMessageDto {
  @ApiProperty({ example: '0b8e6a2c-4d1f-4e3a-9b7c-5d6e7f8a9b0c' })
  id: string;

  @ApiProperty({ enum: MessageRole, example: MessageRole.ASSISTANT })
  role: MessageRole;

  @ApiProperty({ example: '• Point one\n• Point two\n• Point three' })
  content: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '9b2f0c1e-6d7a-4c1b-8e2f-0a1b2c3d4e5f',
    description: 'Provider that answered; null for USER messages',
  })
  providerId: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 842,
    description: 'Provider latency; null for USER messages',
  })
  latencyMs: number | null;

  @ApiProperty({ example: '2026-09-29T10:16:00.000Z' })
  createdAt: Date;
}

export class ConversationDetailDto extends ConversationDto {
  @ApiProperty({ type: [ChatMessageDto], description: 'Oldest first' })
  messages: ChatMessageDto[];
}

export class ChatReplyDto {
  @ApiProperty({ type: ConversationDto })
  conversation: ConversationDto;

  @ApiProperty({ type: ChatMessageDto })
  userMessage: ChatMessageDto;

  @ApiProperty({ type: ChatMessageDto })
  assistantMessage: ChatMessageDto;

  @ApiProperty({
    type: UsageDto,
    description: 'Your usage after this request',
  })
  usage: UsageDto;
}
