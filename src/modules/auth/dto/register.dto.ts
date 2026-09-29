import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

export const toLowerTrim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** ≥ 8 chars with at least one letter and one digit (PRD AU-1). */
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;
export const PASSWORD_MESSAGE =
  'password must be 8-72 characters and contain at least one letter and one digit';

export class RegisterDto {
  @ApiProperty({
    example: 'carol@example.com',
    description: 'Unique, case-insensitive',
  })
  @Transform(toLowerTrim)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({
    example: 'Secret123!',
    minLength: 8,
    maxLength: 72,
    description: 'At least 8 characters with a letter and a digit',
  })
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password: string;

  @ApiProperty({ example: 'Carol Chen', minLength: 2, maxLength: 80 })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  fullName: string;
}
