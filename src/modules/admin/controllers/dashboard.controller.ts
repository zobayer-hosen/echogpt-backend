import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiError,
  ApiErrorResponses,
} from '../../../common/decorators/api-error-responses.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RoleName } from '../../../common/enums/role-name.enum';
import { AdminStatsService } from '../admin-stats.service';
import { DashboardDto } from '../dto/admin.dto';

@ApiTags('Admin · Dashboard')
@Roles(RoleName.ADMIN)
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly stats: AdminStatsService) {}

  @Get()
  @ApiOperation({
    summary: 'Dashboard statistics',
    description:
      'Users (total, new in 7 days, per plan), requests today (HTTP, chat, search), AI error rate in the last 24 h and provider health.',
  })
  @ApiOkResponse({
    type: DashboardDto,
    example: {
      users: {
        total: 1250,
        newLast7Days: 84,
        byPlan: { FREE: 1100, PREMIUM: 150 },
      },
      requestsToday: { http: 5320, chat: 910, search: 402 },
      aiLast24h: { calls: 1200, errors: 18, errorRate: 0.015 },
      providers: [
        {
          id: '9b2f0c1e-6d7a-4c1b-8e2f-0a1b2c3d4e5f',
          name: 'Mock AI',
          type: 'MOCK',
          isEnabled: true,
          isDefault: true,
          healthStatus: 'UP',
          healthCheckedAt: '2026-09-29T10:00:00.000Z',
        },
      ],
      generatedAt: '2026-09-29T10:15:00.000Z',
    },
  })
  @ApiErrorResponses(ApiError.unauthorized, ApiError.forbidden)
  get(): Promise<DashboardDto> {
    return this.stats.dashboard();
  }
}
