import { ApiProperty } from '@nestjs/swagger';
import { UserProfileDto } from '../../users/dto/user-profile.dto';

export class AuthTokensDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOi…',
    description: 'Send as `Authorization: Bearer <accessToken>`',
  })
  accessToken: string;

  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzaWQiOi…',
    description: 'Use once with POST /auth/refresh; a new one is returned',
  })
  refreshToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({ example: 900, description: 'Access token lifetime (seconds)' })
  expiresIn: number;

  @ApiProperty({
    example: 604800,
    description: 'Refresh token lifetime (seconds)',
  })
  refreshExpiresIn: number;
}

export class AuthResponseDto extends AuthTokensDto {
  @ApiProperty({ type: UserProfileDto })
  user: UserProfileDto;
}
