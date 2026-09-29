import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { ApiErrorResponses } from '../../common/decorators/api-error-responses.decorator';
import { Public } from '../../common/decorators/public.decorator';

class HealthStatusDto {
  @ApiProperty({ enum: ['ok', 'down'], example: 'ok' })
  status: 'ok' | 'down';
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Liveness check',
    description:
      'Public. Returns `ok` when the API and its database answer, `down` (503) otherwise. Details are in `GET /admin/health`.',
  })
  @ApiOkResponse({ type: HealthStatusDto, example: { status: 'ok' } })
  @ApiServiceUnavailableResponse({
    type: HealthStatusDto,
    description: 'Database unreachable',
    example: { status: 'down' },
  })
  @ApiErrorResponses()
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthStatusDto> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'down' };
    }
  }
}
