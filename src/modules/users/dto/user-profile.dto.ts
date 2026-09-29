import { ApiProperty } from '@nestjs/swagger';
import { PlanCode } from '../../../common/enums/plan-code.enum';
import { RoleName } from '../../../common/enums/role-name.enum';

/** Public view of a user. Never contains password or token hashes. */
export class UserProfileDto {
  @ApiProperty({ example: '3f6c2a8e-5b8f-4a52-9d0e-7a1b2c3d4e5f' })
  id: string;

  @ApiProperty({ example: 'alice@echogpt.dev' })
  email: string;

  @ApiProperty({ example: 'Alice Free' })
  fullName: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://cdn.echogpt.dev/avatars/alice.png',
  })
  avatarUrl: string | null;

  @ApiProperty({ enum: RoleName, example: RoleName.USER })
  role: RoleName;

  @ApiProperty({ example: false })
  isEmailVerified: boolean;

  @ApiProperty({ enum: PlanCode, example: PlanCode.FREE })
  plan: PlanCode;

  @ApiProperty({ example: '2026-09-29T10:15:00.000Z' })
  createdAt: Date;
}
