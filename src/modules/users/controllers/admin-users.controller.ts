import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorCode } from '../../../common/constants/error-codes';
import {
  ApiError,
  ApiErrorResponses,
} from '../../../common/decorators/api-error-responses.decorator';
import { ApiPaginatedResponse } from '../../../common/decorators/api-paginated-response.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Paginated } from '../../../common/dto/paginated-response.dto';
import { RoleName } from '../../../common/enums/role-name.enum';
import {
  AdminUpdateUserDto,
  AdminUserDto,
  AdminUsersQueryDto,
} from '../dto/admin-user.dto';
import { UsersService } from '../users.service';

const EXAMPLE_ADMIN_USER = {
  id: '3f6c2a8e-5b8f-4a52-9d0e-7a1b2c3d4e5f',
  email: 'alice@echogpt.dev',
  fullName: 'Alice Free',
  avatarUrl: null,
  role: 'USER',
  isEmailVerified: true,
  plan: 'FREE',
  status: 'ACTIVE',
  lastLoginAt: '2026-09-29T09:00:00.000Z',
  createdAt: '2026-09-28T10:15:00.000Z',
  updatedAt: '2026-09-29T09:00:00.000Z',
};

const USER_ID = ApiParam({
  name: 'id',
  format: 'uuid',
  example: '3f6c2a8e-5b8f-4a52-9d0e-7a1b2c3d4e5f',
});

const LAST_ADMIN = ApiError.custom(
  409,
  ErrorCode.LAST_ADMIN,
  'The last active admin cannot be removed, demoted or suspended',
);

@ApiTags('Admin · Users')
@Roles(RoleName.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'List users',
    description:
      'Search by email/name and filter by role, status and plan. Newest first, paginated.',
  })
  @ApiPaginatedResponse(AdminUserDto)
  @ApiErrorResponses(
    ApiError.validation({ limit: ['limit must not be greater than 100'] }),
    ApiError.unauthorized,
    ApiError.forbidden,
  )
  list(@Query() query: AdminUsersQueryDto): Promise<Paginated<AdminUserDto>> {
    return this.users.list(query);
  }

  @Get(':id')
  @USER_ID
  @ApiOperation({ summary: 'Get one user' })
  @ApiOkResponse({ type: AdminUserDto, example: EXAMPLE_ADMIN_USER })
  @ApiErrorResponses(
    ApiError.validation({ id: ['Validation failed (uuid is expected)'] }),
    ApiError.unauthorized,
    ApiError.forbidden,
    ApiError.notFound('User'),
  )
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserDto> {
    return this.users.getForAdmin(id);
  }

  @Patch(':id')
  @USER_ID
  @ApiOperation({
    summary: 'Change role or status',
    description:
      'Promote/demote or suspend/reactivate. Suspending logs the user out everywhere. The last active admin cannot be demoted or suspended.',
  })
  @ApiOkResponse({
    type: AdminUserDto,
    example: { ...EXAMPLE_ADMIN_USER, status: 'SUSPENDED' },
  })
  @ApiErrorResponses(
    ApiError.validation({
      status: ['status must be one of the following values: ACTIVE, SUSPENDED'],
    }),
    ApiError.unauthorized,
    ApiError.forbidden,
    ApiError.notFound('User'),
    LAST_ADMIN,
  )
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateUserDto,
  ): Promise<AdminUserDto> {
    return this.users.updateByAdmin(id, dto);
  }

  @Delete(':id')
  @USER_ID
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a user',
    description: 'Soft delete: revokes all sessions and frees the email.',
  })
  @ApiNoContentResponse({ description: 'User deleted' })
  @ApiErrorResponses(
    ApiError.validation({ id: ['Validation failed (uuid is expected)'] }),
    ApiError.unauthorized,
    ApiError.forbidden,
    ApiError.notFound('User'),
    LAST_ADMIN,
  )
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.users.deleteByAdmin(id);
  }
}
