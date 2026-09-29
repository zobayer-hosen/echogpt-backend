import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiError,
  ApiErrorResponses,
} from '../../../common/decorators/api-error-responses.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RoleName } from '../../../common/enums/role-name.enum';
import { AdminStatsService } from '../admin-stats.service';
import { SystemHealthDto } from '../dto/admin.dto';

@ApiTags('Admin · Health')
@Roles(RoleName.ADMIN)
@Controller('admin/health')
export class SystemHealthController {
  constructor(private readonly stats: AdminStatsService) {}

  @Get()
  @ApiOperation({
    summary: 'System health',
    description:
      'Database ping and latency, uptime, memory, Node version and the last saved status of every provider. Use `GET /admin/providers/health` for live provider checks.',
  })
  @ApiOkResponse({
    type: SystemHealthDto,
    example: {
      status: 'ok',
      database: { status: 'up', latencyMs: 2 },
      uptimeSeconds: 3600,
      memory: { rssMb: 142, heapUsedMb: 61, heapTotalMb: 88 },
      nodeVersion: 'v24.20.0',
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
      checkedAt: '2026-09-29T10:15:00.000Z',
    },
  })
  @ApiErrorResponses(ApiError.unauthorized, ApiError.forbidden)
  get(): Promise<SystemHealthDto> {
    return this.stats.systemHealth();
  }
}
