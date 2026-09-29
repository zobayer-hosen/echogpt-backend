import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { toLowerTrim } from './register.dto';

export class LoginDto {
  @ApiProperty({ example: 'alice@echogpt.dev' })
  @Transform(toLowerTrim)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
