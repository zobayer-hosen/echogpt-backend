import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiError,
  ApiErrorResponses,
} from '../../../common/decorators/api-error-responses.decorator';
import { BEARER_AUTH } from '../../../config/swagger.config';
import { ProviderDto } from '../dto/provider.dto';
import { ProvidersService } from '../providers.service';

@ApiTags('Providers')
@ApiBearerAuth(BEARER_AUTH)
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  @ApiOperation({
    summary: 'List AI providers you can use',
    description:
      'Enabled providers only, default first. Pass an `id` as `providerId` to chat or search; omit it to use the default. Short, fixed-size list, so not paginated.',
  })
  @ApiOkResponse({
    type: [ProviderDto],
    example: [
      {
        id: '9b2f0c1e-6d7a-4c1b-8e2f-0a1b2c3d4e5f',
        name: 'Mock AI',
        type: 'MOCK',
        model: 'mock-1',
        isDefault: true,
      },
      {
        id: '1c3e5a7b-9d0f-4b2a-8c6e-4f2a1b3c5d7e',
        name: 'OpenAI',
        type: 'OPENAI',
        model: 'gpt-4o-mini',
        isDefault: false,
      },
    ],
  })
  @ApiErrorResponses(ApiError.unauthorized)
  list(): Promise<ProviderDto[]> {
    return this.providers.listEnabled();
  }
}
