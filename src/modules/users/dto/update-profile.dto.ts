import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { trim } from '../../auth/dto/register.dto';

/** Only these two fields can change; anything else is rejected (PRD US-2). */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'Alice Anderson',
    minLength: 2,
    maxLength: 80,
  })
  // null is not allowed: only undefined skips validation
  @ValidateIf((_dto, value) => value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  fullName?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'https://cdn.echogpt.dev/avatars/alice.png',
    description: 'http(s) URL, or null to remove the avatar',
  })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  avatarUrl?: string | null;
}
