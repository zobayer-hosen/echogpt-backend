import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ErrorCode } from '../../../common/constants/error-codes';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import { AppConfig } from '../../../config/configuration';
import { AccessTokenPayload, TokenService } from '../token.service';

/**
 * Verifies the access JWT, then checks its session in the DB so logout and
 * revocation take effect immediately (PRD AU-4).
 */
@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly tokens: TokenService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt.accessSecret', { infer: true }),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthUser> {
    if (payload.typ !== 'access' || !payload.sid || !payload.sub) {
      throw this.unauthorized();
    }
    const session = await this.tokens.findActiveSession(payload.sid);
    if (!session || session.userId !== payload.sub) {
      throw this.unauthorized();
    }
    if (session.user.status !== UserStatus.ACTIVE) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ACCOUNT_DISABLED,
        'This account is suspended',
      );
    }
    return {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role.name,
      sessionId: session.id,
    };
  }

  private unauthorized(): AppException {
    return new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.UNAUTHORIZED,
      'Missing, invalid or expired access token',
    );
  }
}
