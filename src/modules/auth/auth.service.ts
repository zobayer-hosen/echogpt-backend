import { HttpStatus, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DataSource, QueryFailedError } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-codes';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PlanCode } from '../../common/enums/plan-code.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { BCRYPT_ROUNDS, UsersService } from '../users/users.service';
import { AuthResponseDto, AuthTokensDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
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
  ) {}

  /** User + FREE subscription in one transaction (PRD AU-1), then a session. */
  async register(
    dto: RegisterDto,
    meta: SessionMeta,
  ): Promise<AuthResponseDto> {
    if (await this.users.emailTaken(dto.email)) {
      throw this.emailTaken();
    }

    let userId: string;
    try {
      userId = await this.dataSource.transaction(async (manager) => {
        const user = await this.users.create(manager, dto);
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

  private emailTaken(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.EMAIL_TAKEN,
      'An account with this email already exists',
    );
  }
}
