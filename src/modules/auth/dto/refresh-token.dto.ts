import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOi…',
    description: 'The latest refresh token; each one works only once',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  refreshToken: string;
}
