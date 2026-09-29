import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorCode } from '../../../common/constants/error-codes';
import {
  ApiError,
  ApiErrorResponses,
} from '../../../common/decorators/api-error-responses.decorator';
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { BEARER_AUTH } from '../../../config/swagger.config';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { DeleteAccountDto } from '../dto/delete-account.dto';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { UserProfileDto } from '../dto/user-profile.dto';
import { UsersService } from '../users.service';

const EXAMPLE_PROFILE = {
  id: '3f6c2a8e-5b8f-4a52-9d0e-7a1b2c3d4e5f',
  email: 'alice@echogpt.dev',
  fullName: 'Alice Free',
  avatarUrl: null,
  role: 'USER',
  isEmailVerified: true,
  plan: 'FREE',
  createdAt: '2026-09-29T10:15:00.000Z',
};

const WRONG_PASSWORD = ApiError.custom(
  401,
  ErrorCode.INVALID_CREDENTIALS,
  'Current password is incorrect',
);

@ApiTags('Users')
@ApiBearerAuth(BEARER_AUTH)
@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'Get my profile',
    description:
      'Your account and current plan. Never includes the password hash.',
  })
  @ApiOkResponse({ type: UserProfileDto, example: EXAMPLE_PROFILE })
  @ApiErrorResponses(ApiError.unauthorized)
  getMe(@CurrentUser() user: AuthUser): Promise<UserProfileDto> {
    return this.users.getProfile(user.id);
  }

  @Patch()
  @ApiOperation({
    summary: 'Update my profile',
    description:
      'Only `fullName` and `avatarUrl` can change. Any other field is rejected with 400.',
  })
  @ApiOkResponse({
    type: UserProfileDto,
    example: { ...EXAMPLE_PROFILE, fullName: 'Alice Anderson' },
  })
  @ApiErrorResponses(
    ApiError.validation({ email: ['property email should not exist'] }),
    ApiError.unauthorized,
  )
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfileDto> {
    return this.users.updateProfile(user.id, dto);
  }

  @Patch('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Change my password',
    description:
      'Needs the current password. The new one must differ. Every **other** session is logged out; this one stays.',
  })
  @ApiNoContentResponse({ description: 'Password changed' })
  @ApiErrorResponses(
    ApiError.validation({ newPassword: ['must differ from currentPassword'] }),
    ApiError.unauthorized,
    WRONG_PASSWORD,
  )
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.users.changePassword(user, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete my account',
    description:
      'Needs the current password. Soft delete: you are logged out everywhere and the email can be registered again. The last admin cannot delete themselves.',
  })
  @ApiNoContentResponse({ description: 'Account deleted' })
  @ApiErrorResponses(
    ApiError.validation({ password: ['password should not be empty'] }),
    ApiError.unauthorized,
    WRONG_PASSWORD,
    ApiError.custom(
      409,
      ErrorCode.LAST_ADMIN,
      'The last active admin cannot be removed, demoted or suspended',
    ),
  )
  async deleteMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: DeleteAccountDto,
  ): Promise<void> {
    await this.users.deleteOwnAccount(user, dto.password);
  }
}
