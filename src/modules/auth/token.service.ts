import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { IsNull, Not, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-codes';
import { RoleName } from '../../common/enums/role-name.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { sha256 } from '../../common/utils/crypto.util';
import { AppConfig } from '../../config/configuration';
import { AuthTokensDto } from './dto/auth-response.dto';
import { Session } from './entities/session.entity';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  role: RoleName;
  typ: 'access';
  /** unique per token, so each issue yields a new token */
  jti: string;
}

interface RefreshTokenPayload {
  sub: string;
  sid: string;
  typ: 'refresh';
  jti: string;
}

export interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

const invalidRefresh = () =>
  new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.REFRESH_TOKEN_INVALID,
    'Refresh token is invalid, expired or revoked',
  );

/** Signs/verifies JWTs and owns `sessions` (create, rotate, revoke). */
@Injectable()
export class TokenService {
  private readonly jwtConfig: AppConfig['jwt'];

  constructor(
    @InjectRepository(Session)
    private readonly sessions: Repository<Session>,
    private readonly jwt: JwtService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.jwtConfig = config.get('jwt', { infer: true });
  }

  /** Starts a new session (one per login/device) and returns its tokens. */
  async createSession(
    user: { id: string; role: RoleName },
    meta: SessionMeta,
  ): Promise<AuthTokensDto> {
    const sid = randomUUID();
    const refreshToken = await this.signRefresh(user.id, sid);
    await this.sessions.insert({
      id: sid,
      userId: user.id,
      refreshTokenHash: sha256(refreshToken),
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
      expiresAt: this.refreshExpiry(),
    });
    return this.toTokens(await this.signAccess(user, sid), refreshToken);
  }

  /**
   * Rotation with reuse detection: a refresh token works exactly once.
   * Presenting an old one revokes the whole session (PRD AU-3).
   */
  async rotate(refreshToken: string): Promise<AuthTokensDto> {
    const payload = await this.verifyRefresh(refreshToken);
    const session = await this.sessions
      .createQueryBuilder('s')
      .addSelect('s.refreshTokenHash')
      .innerJoinAndSelect('s.user', 'u')
      .innerJoinAndSelect('u.role', 'r')
      .where('s.id = :sid', { sid: payload.sid })
      .getOne();

    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.deletedAt
    ) {
      throw invalidRefresh();
    }

    const presentedHash = sha256(refreshToken);
    if (presentedHash !== session.refreshTokenHash) {
      await this.revokeSession(session.id);
      throw this.reused();
    }

    if (session.user.status !== UserStatus.ACTIVE) {
      await this.revokeSession(session.id);
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_DISABLED,
        'This account is suspended',
      );
    }

    const nextRefresh = await this.signRefresh(session.userId, session.id);
    // compare-and-swap: two concurrent uses of one token can't both win
    const result = await this.sessions
      .createQueryBuilder()
      .update(Session)
      .set({
        refreshTokenHash: sha256(nextRefresh),
        expiresAt: this.refreshExpiry(),
      })
      .where('id = :id', { id: session.id })
      .andWhere('refresh_token_hash = :hash', { hash: presentedHash })
      .andWhere('revoked_at IS NULL')
      .execute();
    if (!result.affected) {
      await this.revokeSession(session.id);
      throw this.reused();
    }

    const access = await this.signAccess(
      { id: session.userId, role: session.user.role.name },
      session.id,
    );
    return this.toTokens(access, nextRefresh);
  }

  /** Active session with its user and role, for the JWT guard. */
  findActiveSession(sid: string): Promise<Session | null> {
    return this.sessions
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.user', 'u')
      .innerJoinAndSelect('u.role', 'r')
      .where('s.id = :sid', { sid })
      .andWhere('s.revoked_at IS NULL')
      .andWhere('s.expires_at > now()')
      .andWhere('u.deleted_at IS NULL')
      .getOne();
  }

  async revokeSession(sid: string): Promise<void> {
    await this.sessions.update(
      { id: sid, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /** Revokes every active session of a user, optionally keeping one. */
  async revokeAllForUser(userId: string, exceptSid?: string): Promise<number> {
    const result = await this.sessions.update(
      {
        userId,
        revokedAt: IsNull(),
        ...(exceptSid ? { id: Not(exceptSid) } : {}),
      },
      { revokedAt: new Date() },
    );
    return result.affected ?? 0;
  }

  private async verifyRefresh(token: string): Promise<RefreshTokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.jwtConfig.refreshSecret,
        algorithms: ['HS256'],
      });
      if (payload.typ !== 'refresh' || !payload.sid || !payload.sub) {
        throw invalidRefresh();
      }
      return payload;
    } catch {
      throw invalidRefresh();
    }
  }

  private signAccess(
    user: { id: string; role: RoleName },
    sid: string,
  ): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      sid,
      role: user.role,
      typ: 'access',
      jti: randomUUID(),
    };
    return this.jwt.signAsync(payload, {
      secret: this.jwtConfig.accessSecret,
      expiresIn: this.jwtConfig.accessTtlSeconds,
      algorithm: 'HS256',
    });
  }

  private signRefresh(userId: string, sid: string): Promise<string> {
    const payload: RefreshTokenPayload = {
      sub: userId,
      sid,
      typ: 'refresh',
      jti: randomUUID(),
    };
    return this.jwt.signAsync(payload, {
      secret: this.jwtConfig.refreshSecret,
      expiresIn: this.jwtConfig.refreshTtlSeconds,
      algorithm: 'HS256',
    });
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.jwtConfig.refreshTtlSeconds * 1000);
  }

  private toTokens(accessToken: string, refreshToken: string): AuthTokensDto {
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.jwtConfig.accessTtlSeconds,
      refreshExpiresIn: this.jwtConfig.refreshTtlSeconds,
    };
  }

  private reused(): AppException {
    return new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.REFRESH_TOKEN_REUSED,
      'Refresh token was already used; the session has been revoked',
    );
  }
}
