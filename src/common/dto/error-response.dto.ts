import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** The one error shape returned by every endpoint (PRD §7). */
export class ErrorResponseDto {
  @ApiProperty({ example: 404 })
  statusCode: number;

  @ApiProperty({ example: 'NOT_FOUND', description: 'Stable error code' })
  code: string;

  @ApiProperty({ example: 'Conversation not found' })
  message: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Extra data, e.g. invalid fields or usage numbers',
    example: { email: ['email must be an email'] },
  })
  details?: Record<string, unknown>;

  @ApiProperty({ example: '2026-09-29T10:15:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '/api/v1/chat/conversations/7c1d…' })
  path: string;

  @ApiProperty({ example: '0d9c4e62-3a8e-4b8e-9a53-3f1f0f2f1a11' })
  requestId: string;
}
