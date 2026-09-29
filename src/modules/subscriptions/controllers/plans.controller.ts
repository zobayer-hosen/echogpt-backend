import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../../common/decorators/api-error-responses.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { PlanDto } from '../dto/subscription.dto';
import { SubscriptionsService } from '../subscriptions.service';

@ApiTags('Plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'List plans',
    description:
      'Public. Daily limits come from `FREE_DAILY_LIMIT` / `PREMIUM_DAILY_LIMIT`. Prices are shown only; upgrades are simulated.',
  })
  @ApiOkResponse({
    type: [PlanDto],
    example: [
      {
        code: 'FREE',
        name: 'Free',
        dailyLimit: 20,
        price: 0,
        currency: 'USD',
        billingPeriod: 'month',
      },
      {
        code: 'PREMIUM',
        name: 'Premium',
        dailyLimit: 500,
        price: 9.99,
        currency: 'USD',
        billingPeriod: 'month',
      },
    ],
  })
  @ApiErrorResponses()
  list(): PlanDto[] {
    return this.subscriptions.listPlans();
  }
}
