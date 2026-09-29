import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PlanCode } from '../../../common/enums/plan-code.enum';
import { RoleName } from '../../../common/enums/role-name.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { trim } from '../../auth/dto/register.dto';
import { UserProfileDto } from './user-profile.dto';

/** What admins see about a user. Still no password or token hashes. */
export class AdminUserDto extends UserProfileDto {
  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-09-29T09:00:00.000Z',
  })
  lastLoginAt: Date | null;

  @ApiProperty({ example: '2026-09-29T10:15:00.000Z' })
  updatedAt: Date;
}

export class AdminUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'alice',
    description: 'Matches part of the email or full name',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: RoleName })
  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ enum: PlanCode })
  @IsOptional()
  @IsEnum(PlanCode)
  plan?: PlanCode;
}

export class AdminUpdateUserDto {
  @ApiPropertyOptional({ enum: RoleName, example: RoleName.ADMIN })
  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;

  @ApiPropertyOptional({
    enum: UserStatus,
    example: UserStatus.SUSPENDED,
    description: 'SUSPENDED also revokes all sessions',
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
