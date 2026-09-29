import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { HealthStatus } from '../../../common/enums/health-status.enum';
import { ProviderType } from '../../../common/enums/provider-type.enum';
import { trim } from '../../auth/dto/register.dto';

/** What users see: enabled providers only, never key info (PRD PR-8). */
export class ProviderDto {
  @ApiProperty({ example: '9b2f0c1e-6d7a-4c1b-8e2f-0a1b2c3d4e5f' })
  id: string;

  @ApiProperty({ example: 'Mock AI' })
  name: string;

  @ApiProperty({ enum: ProviderType, example: ProviderType.MOCK })
  type: ProviderType;

  @ApiProperty({ example: 'mock-1' })
  model: string;

  @ApiProperty({ example: true })
  isDefault: boolean;
}

/** What admins see. The key itself is never returned (PRD PR-5). */
export class AdminProviderDto extends ProviderDto {
  @ApiProperty({ example: true })
  isEnabled: boolean;

  @ApiProperty({ example: true })
  hasApiKey: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '••••a1b2',
    description: 'Last 4 characters only',
  })
  apiKeyMasked: string | null;

  @ApiProperty({ enum: HealthStatus, example: HealthStatus.UP })
  healthStatus: HealthStatus;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-09-29T10:15:00.000Z',
  })
  healthCheckedAt: Date | null;

  @ApiProperty({ example: '2026-09-29T10:15:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-09-29T10:15:00.000Z' })
  updatedAt: Date;
}

export class CreateProviderDto {
  @ApiProperty({ example: 'OpenAI GPT-4o mini', maxLength: 50 })
  @Transform(trim)
  @IsString()
  @Length(2, 50)
  name: string;

  @ApiProperty({ enum: ProviderType, example: ProviderType.OPENAI })
  @IsEnum(ProviderType)
  type: ProviderType;

  @ApiProperty({ example: 'gpt-4o-mini', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  model: string;

  @ApiPropertyOptional({
    example: 'sk-proj-…a1b2',
    description:
      'Required unless type is MOCK. Encrypted with AES-256-GCM before saving; never returned.',
    writeOnly: true,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  apiKey?: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

/** Any field; a new `apiKey` replaces the old one, omitting it keeps it (PRD PR-2). */
export class UpdateProviderDto extends PartialType(CreateProviderDto) {}

export class ProviderStatusDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  isEnabled: boolean;
}

export class HealthCheckResultDto {
  @ApiProperty({ example: '9b2f0c1e-6d7a-4c1b-8e2f-0a1b2c3d4e5f' })
  providerId: string;

  @ApiProperty({ example: 'OpenAI' })
  name: string;

  @ApiProperty({ enum: ProviderType, example: ProviderType.OPENAI })
  type: ProviderType;

  @ApiProperty({ enum: [HealthStatus.UP, HealthStatus.DOWN], example: 'UP' })
  status: HealthStatus;

  @ApiProperty({ example: 182 })
  latencyMs: number;

  @ApiProperty({ example: '2026-09-29T10:15:00.000Z' })
  checkedAt: Date;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Why the check failed (never contains the key)',
  })
  error: string | null;
}
