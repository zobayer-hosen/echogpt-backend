import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RoleName } from '../enums/role-name.enum';

/** The logged-in user, attached to the request by the JWT guard. */
export interface AuthUser {
  id: string;
  email: string;
  role: RoleName;
  /** `sid` of the session behind the access token */
  sessionId: string;
}

/** Injects the logged-in user: `@CurrentUser() user: AuthUser`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
