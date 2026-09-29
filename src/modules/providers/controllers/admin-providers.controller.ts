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
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
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
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Paginated } from '../../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { RoleName } from '../../../common/enums/role-name.enum';
import {
  AdminProviderDto,
  CreateProviderDto,
  HealthCheckResultDto,
  ProviderStatusDto,
  UpdateProviderDto,
} from '../dto/provider.dto';
import { ProvidersService } from '../providers.service';

const EXAMPLE = {
  id: '1c3e5a7b-9d0f-4b2a-8c6e-4f2a1b3c5d7e',
  name: 'OpenAI GPT-4o mini',
  type: 'OPENAI',
  model: 'gpt-4o-mini',
  isDefault: false,
  isEnabled: true,
  hasApiKey: true,
  apiKeyMasked: '••••a1b2',
  healthStatus: 'UNKNOWN',
  healthCheckedAt: null,
  createdAt: '2026-09-29T10:15:00.000Z',
  updatedAt: '2026-09-29T10:15:00.000Z',
};

const EXAMPLE_HEALTH = {
  providerId: '1c3e5a7b-9d0f-4b2a-8c6e-4f2a1b3c5d7e',
  name: 'OpenAI GPT-4o mini',
  type: 'OPENAI',
  status: 'UP',
  latencyMs: 182,
  checkedAt: '2026-09-29T10:15:00.000Z',
  error: null,
};

const PROVIDER_ID = ApiParam({
  name: 'id',
  format: 'uuid',
  example: '1c3e5a7b-9d0f-4b2a-8c6e-4f2a1b3c5d7e',
});

const UUID_ERROR = ApiError.validation({
  id: ['Validation failed (uuid is expected)'],
});
const NAME_TAKEN = ApiError.custom(
  409,
  ErrorCode.PROVIDER_NAME_TAKEN,
  'A provider named "OpenAI" already exists',
);
const IS_DEFAULT = (action: string) =>
  ApiError.custom(
    409,
    ErrorCode.PROVIDER_IS_DEFAULT,
    `The default provider cannot be ${action}`,
  );

@ApiTags('Admin · Providers')
@Roles(RoleName.ADMIN)
@Controller('admin/providers')
export class AdminProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  @ApiOperation({
    summary: 'List all providers',
    description:
      'Enabled and disabled. Keys are never returned: only `hasApiKey` and `apiKeyMasked`.',
  })
  @ApiPaginatedResponse(AdminProviderDto)
  @ApiErrorResponses(
    ApiError.validation({ limit: ['limit must not be greater than 100'] }),
    ApiError.unauthorized,
    ApiError.forbidden,
  )
  list(
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<AdminProviderDto>> {
    return this.providers.listForAdmin(query);
  }

  @Get('health')
  @ApiOperation({
    summary: 'Health-check all enabled providers',
    description:
      'Runs a tiny real call against every enabled provider in parallel, saves UP/DOWN and logs each call.',
  })
  @ApiOkResponse({ type: [HealthCheckResultDto], example: [EXAMPLE_HEALTH] })
  @ApiErrorResponses(ApiError.unauthorized, ApiError.forbidden)
  healthAll(@CurrentUser() user: AuthUser): Promise<HealthCheckResultDto[]> {
    return this.providers.healthCheckAll(user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Add a provider',
    description:
      '`apiKey` is required unless `type` is MOCK. It is encrypted (AES-256-GCM) before saving and never returned.',
  })
  @ApiCreatedResponse({ type: AdminProviderDto, example: EXAMPLE })
  @ApiErrorResponses(
    ApiError.validation({ apiKey: ['apiKey is required unless type is MOCK'] }),
    ApiError.unauthorized,
    ApiError.forbidden,
    NAME_TAKEN,
  )
  create(@Body() dto: CreateProviderDto): Promise<AdminProviderDto> {
    return this.providers.create(dto);
  }

  @Patch(':id')
  @PROVIDER_ID
  @ApiOperation({
    summary: 'Edit a provider',
    description:
      'Any field. A new `apiKey` replaces the old one; omitting it keeps the current key.',
  })
  @ApiOkResponse({ type: AdminProviderDto, example: EXAMPLE })
  @ApiErrorResponses(
    ApiError.validation({
      model: ['model must be longer than or equal to 1 characters'],
    }),
    ApiError.unauthorized,
    ApiError.forbidden,
    ApiError.notFound('Provider'),
    NAME_TAKEN,
    IS_DEFAULT('disabled'),
  )
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProviderDto,
  ): Promise<AdminProviderDto> {
    return this.providers.update(id, dto);
  }

  @Delete(':id')
  @PROVIDER_ID
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a provider',
    description:
      'Not allowed for the default provider. Chat and search history keep working (provider set to null).',
  })
  @ApiNoContentResponse({ description: 'Provider deleted' })
  @ApiErrorResponses(
    UUID_ERROR,
    ApiError.unauthorized,
    ApiError.forbidden,
    ApiError.notFound('Provider'),
    IS_DEFAULT('deleted'),
  )
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.providers.remove(id);
  }

  @Patch(':id/status')
  @PROVIDER_ID
  @ApiOperation({
    summary: 'Enable or disable',
    description:
      'Disabled providers cannot be used. The default cannot be disabled; a non-MOCK provider needs a key before it can be enabled.',
  })
  @ApiOkResponse({
    type: AdminProviderDto,
    example: { ...EXAMPLE, isEnabled: false },
  })
  @ApiErrorResponses(
    ApiError.validation({
      apiKey: ['Add an apiKey before enabling this provider'],
    }),
    ApiError.unauthorized,
    ApiError.forbidden,
    ApiError.notFound('Provider'),
    IS_DEFAULT('disabled'),
  )
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProviderStatusDto,
  ): Promise<AdminProviderDto> {
    return this.providers.setEnabled(id, dto.isEnabled);
  }

  @Patch(':id/default')
  @PROVIDER_ID
  @ApiOperation({
    summary: 'Make this the default provider',
    description:
      'Switches in one transaction; the database allows only one default and it must be enabled.',
  })
  @ApiOkResponse({
    type: AdminProviderDto,
    example: { ...EXAMPLE, isDefault: true },
  })
  @ApiErrorResponses(
    UUID_ERROR,
    ApiError.unauthorized,
    ApiError.forbidden,
    ApiError.notFound('Provider'),
    ApiError.custom(
      409,
      ErrorCode.PROVIDER_DISABLED,
      'Provider "OpenAI" is disabled; enable it first',
    ),
  )
  setDefault(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminProviderDto> {
    return this.providers.setDefault(id);
  }

  @Post(':id/health-check')
  @PROVIDER_ID
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Health-check one provider',
    description:
      'Makes a tiny real call (reads the model), saves UP/DOWN and the time, logs it, and returns the latency. A failing provider is reported as DOWN, not as an error.',
  })
  @ApiOkResponse({ type: HealthCheckResultDto, example: EXAMPLE_HEALTH })
  @ApiErrorResponses(
    UUID_ERROR,
    ApiError.unauthorized,
    ApiError.forbidden,
    ApiError.notFound('Provider'),
  )
  healthCheck(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<HealthCheckResultDto> {
    return this.providers.healthCheck(id);
  }
}
