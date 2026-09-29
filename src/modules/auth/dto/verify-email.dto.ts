import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({
    example: 'q3Zb8Xw1c9RkP0sT4vY7aN2mL5eJ6hG8fD1sA3zQ0xU',
    description: 'The one-time token from the verification email (valid 24 h)',
  })
  @IsString()
  @Length(20, 200)
  token: string;
}

export class VerifyEmailResponseDto {
  @ApiProperty({ example: 'carol@example.com' })
  email: string;

  @ApiProperty({ example: true })
  isEmailVerified: boolean;
}

export class ResendVerificationResponseDto {
  @ApiProperty({ example: 'carol@example.com' })
  email: string;

  @ApiProperty({
    example: '2026-09-30T10:15:00.000Z',
    description: 'When the new token expires (24 h)',
  })
  expiresAt: Date;
}
