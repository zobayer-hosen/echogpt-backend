import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PlanCode } from '../../../common/enums/plan-code.enum';

export class PlanDto {
  @ApiProperty({ enum: PlanCode, example: PlanCode.PREMIUM })
  code: PlanCode;

  @ApiProperty({ example: 'Premium' })
  name: string;

  @ApiProperty({
    example: 500,
    description: 'Chat messages + searches per UTC day',
  })
  dailyLimit: number;

  @ApiProperty({ example: 9.99 })
  price: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: 'month' })
  billingPeriod: string;
}

export class SubscriptionDto {
  @ApiProperty({ enum: PlanCode, example: PlanCode.FREE })
  plan: PlanCode;

  @ApiProperty({ example: 'Free' })
  planName: string;

  @ApiProperty({ example: 20 })
  dailyLimit: number;

  @ApiProperty({ example: 0 })
  price: number;

  @ApiProperty({
    example: '2026-09-29T10:15:00.000Z',
    description: 'When the current plan began',
  })
  startedAt: Date;
}

export class UsageDto {
  @ApiProperty({ enum: PlanCode, example: PlanCode.FREE })
  plan: PlanCode;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 7, description: 'Requests used today (UTC)' })
  used: number;

  @ApiProperty({ example: 13 })
  remaining: number;

  @ApiProperty({
    example: '2026-09-30T00:00:00.000Z',
    description: 'Next reset (00:00 UTC)',
  })
  resetsAt: Date;
}

export class ChangePlanDto {
  @ApiProperty({ enum: PlanCode, example: PlanCode.PREMIUM })
  @IsEnum(PlanCode)
  plan: PlanCode;
}

export class AdminSubscriptionDto {
  @ApiProperty({ example: '3f6c2a8e-5b8f-4a52-9d0e-7a1b2c3d4e5f' })
  userId: string;

  @ApiProperty({ example: 'alice@echogpt.dev' })
  email: string;

  @ApiProperty({ example: 'Alice Free' })
  fullName: string;

  @ApiProperty({ enum: PlanCode, example: PlanCode.FREE })
  plan: PlanCode;

  @ApiProperty({ example: 20 })
  dailyLimit: number;

  @ApiProperty({ example: '2026-09-29T10:15:00.000Z' })
  startedAt: Date;

  @ApiProperty({ example: 7 })
  usedToday: number;

  @ApiProperty({ example: 13 })
  remainingToday: number;
}

export class AdminSubscriptionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PlanCode })
  @IsOptional()
  @IsEnum(PlanCode)
  plan?: PlanCode;
}
