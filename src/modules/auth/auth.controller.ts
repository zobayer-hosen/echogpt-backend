import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  ApiError,
  ApiErrorResponses,
} from '../../common/decorators/api-error-responses.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { BEARER_AUTH } from '../../config/swagger.config';
import { AuthService } from './auth.service';
import { AuthResponseDto, AuthTokensDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { SessionMeta } from './token.service';

const sessionMeta = (req: Request): SessionMeta => ({
  userAgent: req.headers['user-agent'],
  ipAddress: req.ip,
});

const EXAMPLE_TOKENS = {
  accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOi…',
  refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzaWQiOi…',
  tokenType: 'Bearer',
  expiresIn: 900,
  refreshExpiresIn: 604800,
};

const EXAMPLE_USER = {
  id: '3f6c2a8e-5b8f-4a52-9d0e-7a1b2c3d4e5f',
  email: 'alice@echogpt.dev',
  fullName: 'Alice Free',
  avatarUrl: null,
  role: 'USER',
  isEmailVerified: true,
  plan: 'FREE',
  createdAt: '2026-09-29T10:15:00.000Z',
};

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Create an account',
    description:
      'Creates a USER with a FREE plan in one transaction and logs them in. Email is case-insensitive.',
  })
  @ApiCreatedResponse({
    type: AuthResponseDto,
    example: {
      ...EXAMPLE_TOKENS,
      user: {
        ...EXAMPLE_USER,
        email: 'carol@example.com',
        fullName: 'Carol Chen',
        isEmailVerified: false,
      },
    },
  })
  @ApiErrorResponses(
    ApiError.validation({
      email: ['email must be an email'],
      password: [
        'password must be 8-72 characters and contain at least one letter and one digit',
      ],
    }),
    ApiError.custom(
      409,
      ErrorCode.EMAIL_TAKEN,
      'An account with this email already exists',
    ),
  )
  register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    return this.auth.register(dto, sessionMeta(req));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in',
    description:
      'Starts a new session (one per device). Limited to 5 attempts per minute per IP.',
  })
  @ApiOkResponse({
    type: AuthResponseDto,
    example: { ...EXAMPLE_TOKENS, user: EXAMPLE_USER },
  })
  @ApiErrorResponses(
    ApiError.validation({ email: ['email must be an email'] }),
    ApiError.custom(
      401,
      ErrorCode.INVALID_CREDENTIALS,
      'Email or password is incorrect',
    ),
    ApiError.custom(
      403,
      ErrorCode.ACCOUNT_DISABLED,
      'This account is suspended',
    ),
  )
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<AuthResponseDto> {
    return this.auth.login(dto, sessionMeta(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate tokens',
    description:
      'Returns a new access token **and** a new refresh token. The old refresh token stops working; using it again revokes the session.',
  })
  @ApiOkResponse({ type: AuthTokensDto, example: EXAMPLE_TOKENS })
  @ApiErrorResponses(
    ApiError.validation({ refreshToken: ['refreshToken should not be empty'] }),
    ApiError.custom(
      401,
      ErrorCode.REFRESH_TOKEN_INVALID,
      'Refresh token is invalid, expired or revoked',
    ),
    ApiError.custom(
      401,
      ErrorCode.REFRESH_TOKEN_REUSED,
      'Refresh token was already used; the session has been revoked',
    ),
    ApiError.custom(
      403,
      ErrorCode.ACCOUNT_DISABLED,
      'This account is suspended',
    ),
  )
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokensDto> {
    return this.auth.refresh(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth(BEARER_AUTH)
  @ApiOperation({
    summary: 'Log out this device',
    description:
      'Revokes the current session. Its access and refresh tokens stop working immediately.',
  })
  @ApiNoContentResponse({ description: 'Session revoked' })
  @ApiErrorResponses(ApiError.unauthorized)
  async logout(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.logout(user);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth(BEARER_AUTH)
  @ApiOperation({
    summary: 'Log out all devices',
    description: 'Revokes every active session of the current user.',
  })
  @ApiNoContentResponse({ description: 'All sessions revoked' })
  @ApiErrorResponses(ApiError.unauthorized)
  async logoutAll(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.logoutAll(user);
  }
}
