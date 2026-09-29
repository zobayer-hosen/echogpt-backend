import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { trim } from '../../auth/dto/register.dto';
import { UsageDto } from '../../subscriptions/dto/subscription.dto';

export class SearchQueryDto {
  @ApiProperty({
    example: 'best practices for chrome extension security',
    minLength: 2,
    maxLength: 300,
  })
  @Transform(trim)
  @IsString()
  @Length(2, 300)
  query: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '9b2f0c1e-6d7a-4c1b-8e2f-0a1b2c3d4e5f',
    description: 'From GET /providers. Omit to use the default provider.',
  })
  @IsOptional()
  @IsUUID()
  providerId?: string;
}

export class SuggestionsQueryDto {
  @ApiProperty({ example: 'chrome ext', minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  q: string;
}

export class SearchResultItemDto {
  @ApiProperty({ example: 'Chrome extension security checklist' })
  title: string;

  @ApiProperty({ example: 'https://developer.chrome.com/docs/extensions' })
  url: string;

  @ApiProperty({
    example: 'Use a strict content security policy and least privilege…',
  })
  snippet: string;
}

export class SearchHistoryItemDto {
  @ApiProperty({ example: '5e7a9c1b-3d5f-4a7b-9c1d-2e4f6a8b0c2d' })
  id: string;

  @ApiProperty({
    example: 'best practices for chrome extension security',
    description: 'As typed',
  })
  query: string;

  @ApiProperty({
    example: 'Request only the permissions you need, use a strict CSP, …',
  })
  answer: string;

  @ApiProperty({ type: [SearchResultItemDto] })
  results: SearchResultItemDto[];

  @ApiProperty({
    example: false,
    description:
      'true when reused from an identical search within the cache TTL',
  })
  fromCache: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '9b2f0c1e-6d7a-4c1b-8e2f-0a1b2c3d4e5f',
  })
  providerId: string | null;

  @ApiProperty({ example: '2026-09-29T10:15:00.000Z' })
  createdAt: Date;
}

export class SearchResponseDto extends SearchHistoryItemDto {
  @ApiProperty({ type: UsageDto, description: 'Your usage after this request' })
  usage: UsageDto;
}

export class RecentSearchDto {
  @ApiProperty({ example: 'best practices for chrome extension security' })
  query: string;

  @ApiProperty({ example: '2026-09-29T10:15:00.000Z' })
  lastSearchedAt: Date;
}

export class SuggestionDto {
  @ApiProperty({ example: 'chrome extension security' })
  query: string;

  @ApiProperty({
    enum: ['HISTORY', 'POPULAR'],
    example: 'HISTORY',
    description:
      'HISTORY = your own past query; POPULAR = searched by several users recently',
  })
  source: 'HISTORY' | 'POPULAR';
}
