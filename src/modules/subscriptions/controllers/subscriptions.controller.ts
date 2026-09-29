import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
import {
  ChangePlanDto,
  SubscriptionDto,
  UsageDto,
} from '../dto/subscription.dto';
import { SubscriptionsService } from '../subscriptions.service';

@ApiTags('Subscriptions')
@ApiBearerAuth(BEARER_AUTH)
@Controller('subscriptions/me')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: 'My subscription status' })
  @ApiOkResponse({
    type: SubscriptionDto,
    example: {
      plan: 'FREE',
      planName: 'Free',
      dailyLimit: 20,
      price: 0,
      startedAt: '2026-09-29T10:15:00.000Z',
    },
  })
  @ApiErrorResponses(ApiError.unauthorized)
  status(@CurrentUser() user: AuthUser): Promise<SubscriptionDto> {
    return this.subscriptions.getStatus(user.id);
  }

  @Post('change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Upgrade or downgrade',
    description:
      'Immediate and simulated (no payment). Today’s usage is kept: after a downgrade, `remaining` can be 0.',
  })
  @ApiOkResponse({
    type: SubscriptionDto,
    example: {
      plan: 'PREMIUM',
      planName: 'Premium',
      dailyLimit: 500,
      price: 9.99,
      startedAt: '2026-09-29T11:00:00.000Z',
    },
  })
  @ApiErrorResponses(
    ApiError.validation({
      plan: ['plan must be one of the following values: FREE, PREMIUM'],
    }),
    ApiError.unauthorized,
    ApiError.custom(
      409,
      ErrorCode.ALREADY_ON_PLAN,
      'Already on the Premium plan',
    ),
  )
  change(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePlanDto,
  ): Promise<SubscriptionDto> {
    return this.subscriptions.changePlan(user.id, dto.plan);
  }

  @Get('usage')
  @ApiOperation({
    summary: 'My remaining requests today',
    description:
      'Every chat message and search counts one request. The counter resets at 00:00 UTC.',
  })
  @ApiOkResponse({
    type: UsageDto,
    example: {
      plan: 'FREE',
      limit: 20,
      used: 7,
      remaining: 13,
      resetsAt: '2026-09-30T00:00:00.000Z',
    },
  })
  @ApiErrorResponses(ApiError.unauthorized)
  usage(@CurrentUser() user: AuthUser): Promise<UsageDto> {
    return this.subscriptions.getUsage(user.id);
  }
}
