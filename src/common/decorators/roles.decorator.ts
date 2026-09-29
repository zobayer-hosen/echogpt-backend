import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { BEARER_AUTH } from '../../config/swagger.config';
import { RoleName } from '../enums/role-name.enum';
import { ROLES_KEY, RolesGuard } from '../guards/roles.guard';

export { ROLES_KEY };

/**
 * Restricts a controller or route to the given roles (PRD US-5).
 * Runs after the global JWT guard, so the user is already known.
 */
export const Roles = (...roles: RoleName[]) =>
  applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    UseGuards(RolesGuard),
    ApiBearerAuth(BEARER_AUTH),
  );
