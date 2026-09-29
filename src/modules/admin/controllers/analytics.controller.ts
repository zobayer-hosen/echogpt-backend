import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiError,
  ApiErrorResponses,
} from '../../../common/decorators/api-error-responses.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RoleName } from '../../../common/enums/role-name.enum';
import { AdminStatsService } from '../admin-stats.service';
import { UsageAnalyticsDto, UsageAnalyticsQueryDto } from '../dto/admin.dto';

@ApiTags('Admin · Analytics')
@Roles(RoleName.ADMIN)
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly stats: AdminStatsService) {}

  @Get('usage')
  @ApiOperation({
    summary: 'AI usage analytics',
    description:
      'AI provider calls between `from` and `to` (default: last 7 days, max 366), grouped by `day` (UTC), `provider` or `feature`: counts, success rate and average latency. Cached searches are not AI calls and are not counted.',
  })
  @ApiOkResponse({
    type: UsageAnalyticsDto,
    example: {
      from: '2026-09-22T10:15:00.000Z',
      to: '2026-09-29T10:15:00.000Z',
      groupBy: 'provider',
      totals: {
        key: null,
        label: 'all',
        requests: 130,
        successes: 127,
        failures: 3,
        successRate: 0.9769,
        avgLatencyMs: 610,
      },
      rows: [
        {
          key: '9b2f0c1e-6d7a-4c1b-8e2f-0a1b2c3d4e5f',
          label: 'Mock AI',
          requests: 100,
          successes: 100,
          failures: 0,
          successRate: 1,
          avgLatencyMs: 3,
        },
        {
          key: '1c3e5a7b-9d0f-4b2a-8c6e-4f2a1b3c5d7e',
          label: 'OpenAI',
          requests: 30,
          successes: 27,
          failures: 3,
          successRate: 0.9,
          avgLatencyMs: 2620,
        },
      ],
    },
  })
  @ApiErrorResponses(
    ApiError.validation({
      groupBy: [
        'groupBy must be one of the following values: day, provider, feature',
      ],
    }),
    ApiError.unauthorized,
    ApiError.forbidden,
  )
  usage(@Query() query: UsageAnalyticsQueryDto): Promise<UsageAnalyticsDto> {
    return this.stats.usage(query);
  }
}
