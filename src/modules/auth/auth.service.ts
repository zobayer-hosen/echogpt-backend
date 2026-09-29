import { HttpStatus, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DataSource, QueryFailedError } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-codes';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PlanCode } from '../../common/enums/plan-code.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { randomToken, sha256 } from '../../common/utils/crypto.util';
import {
  BCRYPT_ROUNDS,
  EMAIL_TOKEN_TTL_HOURS,
  UsersService,
} from '../users/users.service';
import { AuthResponseDto, AuthTokensDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import {
  ResendVerificationResponseDto,
  VerifyEmailDto,
  VerifyEmailResponseDto,
} from './dto/verify-email.dto';
import { MailService } from './mail.service';
import { SessionMeta, TokenService } from './token.service';

/** Compared against when the email is unknown, so timing doesn't reveal it. */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UsersService,
    private readonly subscriptions: SubscriptionsService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
  ) {}

  /** User + FREE subscription in one transaction (PRD AU-1), then a session. */
  async register(
    dto: RegisterDto,
    meta: SessionMeta,
  ): Promise<AuthResponseDto> {
    if (await this.users.emailTaken(dto.email)) {
      throw this.emailTaken();
    }

    const verifyToken = randomToken();
    const verifyExpiresAt = new Date(
      Date.now() + EMAIL_TOKEN_TTL_HOURS * 3600 * 1000,
    );
    let userId: string;
    try {
      userId = await this.dataSource.transaction(async (manager) => {
        const user = await this.users.create(manager, {
          ...dto,
          emailVerification: {
            tokenHash: sha256(verifyToken),
            expiresAt: verifyExpiresAt,
          },
        });
        await this.subscriptions.createFree(manager, user.id);
        return user.id;
      });
    } catch (error) {
      // a concurrent register with the same email lost the race
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION
      ) {
        throw this.emailTaken();
      }
      throw error;
    }

    this.mail.sendVerificationEmail(dto.email, verifyToken, verifyExpiresAt);

    const user = await this.users.findByIdOrFail(userId);
    const tokens = await this.tokens.createSession(
      { id: user.id, role: user.role.name },
      meta,
    );
    return { ...tokens, user: this.users.toProfile(user, PlanCode.FREE) };
  }

  /** Same 401 for unknown email and wrong password (PRD AU-2). */
  async login(dto: LoginDto, meta: SessionMeta): Promise<AuthResponseDto> {
    const user = await this.users.findForLogin(dto.email);
    const passwordOk = await this.users.verifyPassword(
      dto.password,
      user?.passwordHash ?? DUMMY_HASH,
    );
    if (!user || !passwordOk) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.INVALID_CREDENTIALS,
        'Email or password is incorrect',
      );
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_DISABLED,
        'This account is suspended',
      );
    }

    await this.users.markLoggedIn(user.id);
    const tokens = await this.tokens.createSession(
      { id: user.id, role: user.role.name },
      meta,
    );
    return { ...tokens, user: await this.users.getProfile(user.id) };
  }

  refresh(dto: RefreshTokenDto): Promise<AuthTokensDto> {
    return this.tokens.rotate(dto.refreshToken);
  }

  async logout(user: AuthUser): Promise<void> {
    await this.tokens.revokeSession(user.sessionId);
  }

  async logoutAll(user: AuthUser): Promise<void> {
    await this.tokens.revokeAllForUser(user.id);
  }

  /** One-time token from the email → verified (PRD AU-7). Not required to use the API. */
  async verifyEmail(dto: VerifyEmailDto): Promise<VerifyEmailResponseDto> {
    const email = await this.users.verifyEmail(sha256(dto.token));
    if (!email) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.EMAIL_TOKEN_INVALID,
        'Verification token is invalid, expired or already used',
      );
    }
    return { email, isEmailVerified: true };
  }

  /** New token and email, at most once per minute; the old token stops working. */
  async resendVerification(
    user: AuthUser,
  ): Promise<ResendVerificationResponseDto> {
    const token = randomToken();
    const result = await this.users.replaceEmailToken(user.id, sha256(token));
    if ('refused' in result) {
      if (result.refused === 'ALREADY_VERIFIED') {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.EMAIL_ALREADY_VERIFIED,
          'This email is already verified',
        );
      }
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.RATE_LIMITED,
        'A verification email was sent less than a minute ago',
        { retryAfterSeconds: result.retryAfterSeconds },
      );
    }
    this.mail.sendVerificationEmail(user.email, token, result.expiresAt);
    return { email: user.email, expiresAt: result.expiresAt };
  }

  private emailTaken(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.EMAIL_TAKEN,
      'An account with this email already exists',
    );
  }
}
