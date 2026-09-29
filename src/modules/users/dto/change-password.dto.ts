import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { PASSWORD_MESSAGE, PASSWORD_RULE } from '../../auth/dto/register.dto';

export class ChangePasswordDto {
  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty({
    example: 'NewSecret456!',
    description:
      'At least 8 characters with a letter and a digit; must differ from the current one',
  })
  @IsString()
  @Matches(PASSWORD_RULE, { message: `newP${PASSWORD_MESSAGE.slice(1)}` })
  newPassword: string;
}
