import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
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
  AdminSubscriptionDto,
  AdminSubscriptionsQueryDto,
  ChangePlanDto,
} from '../dto/subscription.dto';
import { SubscriptionsService } from '../subscriptions.service';

@ApiTags('Admin · Subscriptions')
@Roles(RoleName.ADMIN)
@Controller('admin/subscriptions')
export class AdminSubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @ApiOperation({
    summary: 'List subscriptions',
    description:
      "Every user's plan and today's usage. Filter by plan; sorted by email.",
  })
  @ApiPaginatedResponse(AdminSubscriptionDto)
  @ApiErrorResponses(
    ApiError.validation({
      plan: ['plan must be one of the following values: FREE, PREMIUM'],
    }),
    ApiError.unauthorized,
    ApiError.forbidden,
  )
  list(
    @Query() query: AdminSubscriptionsQueryDto,
  ): Promise<Paginated<AdminSubscriptionDto>> {
    return this.subscriptions.listForAdmin(query);
  }

  @Patch(':userId')
  @ApiParam({
    name: 'userId',
    format: 'uuid',
    example: '3f6c2a8e-5b8f-4a52-9d0e-7a1b2c3d4e5f',
  })
  @ApiOperation({ summary: "Change a user's plan" })
  @ApiOkResponse({
    type: AdminSubscriptionDto,
    example: {
      userId: '3f6c2a8e-5b8f-4a52-9d0e-7a1b2c3d4e5f',
      email: 'alice@echogpt.dev',
      fullName: 'Alice Free',
      plan: 'PREMIUM',
      dailyLimit: 500,
      startedAt: '2026-09-29T11:00:00.000Z',
      usedToday: 7,
      remainingToday: 493,
    },
  })
  @ApiErrorResponses(
    ApiError.validation({
      plan: ['plan must be one of the following values: FREE, PREMIUM'],
    }),
    ApiError.unauthorized,
    ApiError.forbidden,
    ApiError.notFound('User'),
    ApiError.custom(
      409,
      ErrorCode.ALREADY_ON_PLAN,
      'Already on the Premium plan',
    ),
  )
  change(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ChangePlanDto,
  ): Promise<AdminSubscriptionDto> {
    return this.subscriptions.changePlanByAdmin(userId, dto.plan);
  }
}
