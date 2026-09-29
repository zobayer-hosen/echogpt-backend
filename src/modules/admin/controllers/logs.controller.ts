import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiError,
  ApiErrorResponses,
} from '../../../common/decorators/api-error-responses.decorator';
import { ApiPaginatedResponse } from '../../../common/decorators/api-paginated-response.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Paginated } from '../../../common/dto/paginated-response.dto';
import { RoleName } from '../../../common/enums/role-name.enum';
import { AdminStatsService } from '../admin-stats.service';
import { RequestLogDto, RequestLogsQueryDto } from '../dto/admin.dto';

@ApiTags('Admin · Logs')
@Roles(RoleName.ADMIN)
@Controller('admin/logs')
export class LogsController {
  constructor(private readonly stats: AdminStatsService) {}

  @Get('requests')
  @ApiOperation({
    summary: 'HTTP request logs',
    description:
      'One row per request, newest first. Filter by time range, status code, user and part of the path. Bodies and query strings are never stored.',
  })
  @ApiPaginatedResponse(RequestLogDto)
  @ApiErrorResponses(
    ApiError.validation({ status: ['status must not be greater than 599'] }),
    ApiError.unauthorized,
    ApiError.forbidden,
  )
  list(@Query() query: RequestLogsQueryDto): Promise<Paginated<RequestLogDto>> {
    return this.stats.requestLogs(query);
  }
}
