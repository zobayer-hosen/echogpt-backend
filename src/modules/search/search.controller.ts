import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  ApiError,
  ApiErrorResponses,
} from '../../common/decorators/api-error-responses.decorator';
import { ApiPaginatedResponse } from '../../common/decorators/api-paginated-response.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BEARER_AUTH } from '../../config/swagger.config';
import {
  RecentSearchDto,
  SearchHistoryItemDto,
  SearchQueryDto,
  SearchResponseDto,
  SuggestionDto,
  SuggestionsQueryDto,
} from './dto/search.dto';
import { SearchService } from './search.service';

const ITEM = {
  id: '5e7a9c1b-3d5f-4a7b-9c1d-2e4f6a8b0c2d',
  query: 'best practices for chrome extension security',
  answer:
    'Request only the permissions you need, use a strict CSP and never store secrets in the extension.',
  results: [
    {
      title: 'Stay secure - Chrome for Developers',
      url: 'https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure',
      snippet:
        'Extensions have access to special privileges within the browser…',
    },
  ],
  fromCache: false,
  providerId: '9b2f0c1e-6d7a-4c1b-8e2f-0a1b2c3d4e5f',
  createdAt: '2026-09-29T10:15:00.000Z',
};

@ApiTags('Search')
@ApiBearerAuth(BEARER_AUTH)
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'AI-assisted web search',
    description:
      'Returns a short answer and a list of pages, and saves the search to your history. Counts one request. The same normalized query + provider within 1 hour is served from cache (`fromCache: true`, provider not called) and still counts.',
  })
  @ApiOkResponse({
    type: SearchResponseDto,
    example: {
      ...ITEM,
      usage: {
        plan: 'FREE',
        limit: 20,
        used: 3,
        remaining: 17,
        resetsAt: '2026-09-30T00:00:00.000Z',
      },
    },
  })
  @ApiErrorResponses(
    ApiError.validation({
      query: ['query must be longer than or equal to 2 characters'],
    }),
    ApiError.unauthorized,
    ApiError.notFound('Provider'),
    ApiError.custom(
      409,
      ErrorCode.PROVIDER_DISABLED,
      'Provider "OpenAI" is disabled',
    ),
    ApiError.custom(
      429,
      ErrorCode.USAGE_LIMIT_EXCEEDED,
      'Daily limit of 20 requests reached',
      {
        limit: 20,
        used: 20,
        remaining: 0,
        resetsAt: '2026-09-30T00:00:00.000Z',
      },
    ),
    ApiError.custom(502, ErrorCode.PROVIDER_ERROR, 'OpenAI returned HTTP 500'),
    ApiError.custom(
      504,
      ErrorCode.PROVIDER_TIMEOUT,
      'OpenAI did not answer within 30s',
    ),
  )
  run(
    @CurrentUser() user: AuthUser,
    @Body() dto: SearchQueryDto,
  ): Promise<SearchResponseDto> {
    return this.search.search(user.id, dto);
  }

  @Get('history')
  @ApiOperation({ summary: 'My search history', description: 'Newest first.' })
  @ApiPaginatedResponse(SearchHistoryItemDto)
  @ApiErrorResponses(
    ApiError.validation({ limit: ['limit must not be greater than 100'] }),
    ApiError.unauthorized,
  )
  history(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<SearchHistoryItemDto>> {
    return this.search.history(user.id, query);
  }

  @Delete('history')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear my search history' })
  @ApiNoContentResponse({ description: 'History cleared' })
  @ApiErrorResponses(ApiError.unauthorized)
  async clear(@CurrentUser() user: AuthUser): Promise<void> {
    await this.search.deleteAll(user.id);
  }

  @Delete('history/:id')
  @ApiParam({ name: 'id', format: 'uuid', example: ITEM.id })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete one search from my history' })
  @ApiNoContentResponse({ description: 'Search deleted' })
  @ApiErrorResponses(
    ApiError.validation({ id: ['Validation failed (uuid is expected)'] }),
    ApiError.unauthorized,
    ApiError.notFound('Search'),
  )
  async deleteOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.search.deleteOne(user.id, id);
  }

  @Get('recent')
  @ApiOperation({
    summary: 'My recent searches',
    description: 'The last 10 distinct queries, newest first.',
  })
  @ApiOkResponse({
    type: [RecentSearchDto],
    example: [
      {
        query: 'best practices for chrome extension security',
        lastSearchedAt: '2026-09-29T10:15:00.000Z',
      },
    ],
  })
  @ApiErrorResponses(ApiError.unauthorized)
  recent(@CurrentUser() user: AuthUser): Promise<RecentSearchDto[]> {
    return this.search.recent(user.id);
  }

  @Get('suggestions')
  @ApiOperation({
    summary: 'Search suggestions',
    description:
      'Up to 8 queries starting with `q`: your own past queries first, then queries several users searched in the last 7 days.',
  })
  @ApiOkResponse({
    type: [SuggestionDto],
    example: [
      { query: 'chrome extension security', source: 'HISTORY' },
      { query: 'chrome extension manifest v3', source: 'POPULAR' },
    ],
  })
  @ApiErrorResponses(
    ApiError.validation({
      q: ['q must be longer than or equal to 1 characters'],
    }),
    ApiError.unauthorized,
  )
  suggestions(
    @CurrentUser() user: AuthUser,
    @Query() query: SuggestionsQueryDto,
  ): Promise<SuggestionDto[]> {
    return this.search.suggestions(user.id, query.q);
  }
}
