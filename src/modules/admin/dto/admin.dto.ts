import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { HealthStatus } from '../../../common/enums/health-status.enum';
import { ProviderType } from '../../../common/enums/provider-type.enum';
import { UsageFeature } from '../../../common/enums/usage-feature.enum';

// ---- shared ----

export class DateRangeQueryDto {
  @ApiPropertyOptional({
    example: '2026-09-22T00:00:00.000Z',
    description: 'Start (inclusive, ISO-8601). Default: 7 days before `to`.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-09-30T00:00:00.000Z',
    description: 'End (exclusive, ISO-8601). Default: now.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ProviderHealthDto {
  @ApiProperty({ example: '9b2f0c1e-6d7a-4c1b-8e2f-0a1b2c3d4e5f' })
  id: string;

  @ApiProperty({ example: 'Mock AI' })
  name: string;

  @ApiProperty({ enum: ProviderType, example: ProviderType.MOCK })
  type: ProviderType;

  @ApiProperty({ example: true })
  isEnabled: boolean;

  @ApiProperty({ example: true })
  isDefault: boolean;

  @ApiProperty({ enum: HealthStatus, example: HealthStatus.UP })
  healthStatus: HealthStatus;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-09-29T10:15:00.000Z',
  })
  healthCheckedAt: Date | null;
}

// ---- dashboard (AD-1) ----

class UserStatsDto {
  @ApiProperty({ example: 1250 })
  total: number;

  @ApiProperty({ example: 84 })
  newLast7Days: number;

  @ApiProperty({ example: { FREE: 1100, PREMIUM: 150 } })
  byPlan: Record<string, number>;
}

class RequestStatsDto {
  @ApiProperty({ example: 5320, description: 'All HTTP requests today (UTC)' })
  http: number;

  @ApiProperty({ example: 910, description: 'Chat prompts today' })
  chat: number;

  @ApiProperty({ example: 402, description: 'Searches today (incl. cached)' })
  search: number;
}

class AiStatsDto {
  @ApiProperty({ example: 1200, description: 'AI provider calls, last 24 h' })
  calls: number;

  @ApiProperty({ example: 18 })
  errors: number;

  @ApiProperty({
    example: 0.015,
    description: 'errors / calls (0 when no calls)',
  })
  errorRate: number;
}

export class DashboardDto {
  @ApiProperty({ type: UserStatsDto })
  users: UserStatsDto;

  @ApiProperty({ type: RequestStatsDto })
  requestsToday: RequestStatsDto;

  @ApiProperty({ type: AiStatsDto })
  aiLast24h: AiStatsDto;

  @ApiProperty({ type: [ProviderHealthDto] })
  providers: ProviderHealthDto[];

  @ApiProperty({ example: '2026-09-29T10:15:00.000Z' })
  generatedAt: Date;
}

// ---- analytics (AD-5) ----

export enum AnalyticsGroupBy {
  DAY = 'day',
  PROVIDER = 'provider',
  FEATURE = 'feature',
}

export class UsageAnalyticsQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({
    enum: AnalyticsGroupBy,
    default: AnalyticsGroupBy.DAY,
  })
  @IsOptional()
  @IsEnum(AnalyticsGroupBy)
  groupBy: AnalyticsGroupBy = AnalyticsGroupBy.DAY;
}

export class UsageAnalyticsRowDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-09-29',
    description: 'Day (YYYY-MM-DD, UTC), provider id or feature',
  })
  key: string | null;

  @ApiProperty({ example: '2026-09-29', description: 'Human-readable key' })
  label: string;

  @ApiProperty({ example: 120 })
  requests: number;

  @ApiProperty({ example: 118 })
  successes: number;

  @ApiProperty({ example: 2 })
  failures: number;

  @ApiProperty({ example: 0.9833 })
  successRate: number;

  @ApiProperty({ example: 640 })
  avgLatencyMs: number;
}

export class UsageAnalyticsDto {
  @ApiProperty({ example: '2026-09-22T00:00:00.000Z' })
  from: Date;

  @ApiProperty({ example: '2026-09-29T10:15:00.000Z' })
  to: Date;

  @ApiProperty({ enum: AnalyticsGroupBy, example: AnalyticsGroupBy.DAY })
  groupBy: AnalyticsGroupBy;

  @ApiProperty({ type: UsageAnalyticsRowDto, description: 'All rows together' })
  totals: UsageAnalyticsRowDto;

  @ApiProperty({ type: [UsageAnalyticsRowDto] })
  rows: UsageAnalyticsRowDto[];
}

// ---- request logs (AD-6) ----

export class RequestLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-09-29T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ example: 429, minimum: 100, maximum: 599 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(599)
  status?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    example: '/api/v1/chat',
    description: 'Part of the path (case-insensitive)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  path?: string;
}

export class RequestLogDto {
  @ApiProperty({ example: '1024' })
  id: string;

  @ApiProperty({ example: 'POST' })
  method: string;

  @ApiProperty({ example: '/api/v1/chat/messages' })
  path: string;

  @ApiProperty({ example: 201 })
  statusCode: number;

  @ApiProperty({ example: 812 })
  durationMs: number;

  @ApiProperty({ type: String, nullable: true, example: '::1' })
  ipAddress: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '3f6c2a8e-5b8f-4a52-9d0e-7a1b2c3d4e5f',
  })
  userId: string | null;

  @ApiProperty({
    enum: UsageFeature,
    nullable: true,
    example: UsageFeature.CHAT,
  })
  feature: UsageFeature | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '9b2f0c1e-6d7a-4c1b-8e2f-0a1b2c3d4e5f',
  })
  providerId: string | null;

  @ApiProperty({ type: Boolean, nullable: true, example: true })
  aiSuccess: boolean | null;

  @ApiProperty({ example: '2026-09-29T10:15:00.000Z' })
  createdAt: Date;
}

// ---- system health (AD-7) ----

class DatabaseHealthDto {
  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  status: 'up' | 'down';

  @ApiProperty({ type: Number, nullable: true, example: 2 })
  latencyMs: number | null;
}

class MemoryDto {
  @ApiProperty({ example: 142 })
  rssMb: number;

  @ApiProperty({ example: 61 })
  heapUsedMb: number;

  @ApiProperty({ example: 88 })
  heapTotalMb: number;
}

export class SystemHealthDto {
  @ApiProperty({
    enum: ['ok', 'degraded'],
    example: 'ok',
    description: 'degraded when the DB is down or the default provider is DOWN',
  })
  status: 'ok' | 'degraded';

  @ApiProperty({ type: DatabaseHealthDto })
  database: DatabaseHealthDto;

  @ApiProperty({ example: 3600 })
  uptimeSeconds: number;

  @ApiProperty({ type: MemoryDto })
  memory: MemoryDto;

  @ApiProperty({ example: 'v24.20.0' })
  nodeVersion: string;

  @ApiProperty({
    type: [ProviderHealthDto],
    description: 'Last saved health of every provider (no live calls)',
  })
  providers: ProviderHealthDto[];

  @ApiProperty({ example: '2026-09-29T10:15:00.000Z' })
  checkedAt: Date;
}
