import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { UsageFeature } from '../../common/enums/usage-feature.enum';
import { AppException } from '../../common/exceptions/app.exception';
import {
  escapeLike,
  pageOffset,
  toPage,
} from '../../common/utils/pagination.util';
import { RequestContext } from '../../common/utils/request-context';
import { normalizeQuery } from '../../common/utils/text.util';
import { AppConfig } from '../../config/configuration';
import { SearchResult } from '../providers/adapters/ai-provider-adapter.interface';
import { ProvidersService } from '../providers/providers.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  RecentSearchDto,
  SearchHistoryItemDto,
  SearchQueryDto,
  SearchResponseDto,
  SuggestionDto,
} from './dto/search.dto';
import { WebSearch } from './entities/web-search.entity';

const RECENT_LIMIT = 10;
const SUGGESTION_LIMIT = 8;
/** "popular" = searched by at least this many different users in the window */
const POPULAR_MIN_USERS = 2;
const POPULAR_WINDOW_DAYS = 7;

/** Owns `web_searches`: search, history, recent, suggestions and the cache. */
@Injectable()
export class SearchService {
  private readonly cacheTtlSeconds: number;

  constructor(
    @InjectRepository(WebSearch)
    private readonly searches: Repository<WebSearch>,
    private readonly providers: ProvidersService,
    private readonly subscriptions: SubscriptionsService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.cacheTtlSeconds = config.get('search.cacheTtlSeconds', {
      infer: true,
    });
  }

  /**
   * Counts one request, then serves from the 1-hour cache (same normalized
   * query + provider) or calls the provider. Cached searches still count
   * (PRD WS-5). A failed AI call gives the request back.
   */
  async search(
    userId: string,
    dto: SearchQueryDto,
  ): Promise<SearchResponseDto> {
    const normalizedQuery = normalizeQuery(dto.query);
    const { provider, adapter } = await this.providers.resolveForUse(
      dto.providerId,
    );
    const usage = await this.subscriptions.useRequest(userId);

    const cached = await this.findCached(normalizedQuery, provider.id);
    let result: Pick<SearchResult, 'answer' | 'results'>;
    if (cached) {
      result = cached;
    } else {
      try {
        result = await adapter.search(dto.query);
      } catch (error) {
        await this.subscriptions.giveBackRequest(userId);
        RequestContext.setAiCall({
          feature: UsageFeature.SEARCH,
          providerId: provider.id,
          success: false,
        });
        throw error;
      }
      RequestContext.setAiCall({
        feature: UsageFeature.SEARCH,
        providerId: provider.id,
        success: true,
      });
    }

    const saved = await this.searches.save(
      this.searches.create({
        userId,
        query: dto.query,
        normalizedQuery,
        providerId: provider.id,
        answer: result.answer,
        results: result.results,
        fromCache: Boolean(cached),
      }),
    );
    return { ...this.toItem(saved), usage };
  }

  /** Own searches, newest first (PRD WS-2). */
  async history(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<SearchHistoryItemDto>> {
    const [rows, total] = await this.searches.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC', id: 'ASC' },
      skip: pageOffset(query),
      take: query.limit,
    });
    return toPage(
      rows.map((r) => this.toItem(r)),
      total,
      query,
    );
  }

  async deleteOne(userId: string, id: string): Promise<void> {
    const result = await this.searches.delete({ id, userId });
    if (!result.affected) {
      throw AppException.notFound('Search');
    }
  }

  async deleteAll(userId: string): Promise<void> {
    await this.searches.delete({ userId });
  }

  /** The last 10 distinct queries (PRD WS-3). */
  async recent(userId: string): Promise<RecentSearchDto[]> {
    const rows = await this.searches.query<
      { query: string; last_searched_at: Date }[]
    >(
      `SELECT query, last_searched_at FROM (
         SELECT DISTINCT ON (normalized_query) query, created_at AS last_searched_at
           FROM web_searches
          WHERE user_id = $1
          ORDER BY normalized_query, created_at DESC
       ) latest
       ORDER BY last_searched_at DESC
       LIMIT ${RECENT_LIMIT}`,
      [userId],
    );
    return rows.map((r) => ({
      query: r.query,
      lastSearchedAt: r.last_searched_at,
    }));
  }

  /**
   * Up to 8: your own past queries starting with `q` (newest first), then
   * popular recent queries from all users (PRD WS-4). "Popular" needs at
   * least 2 different users, so one person's searches are never shown to others.
   */
  async suggestions(userId: string, q: string): Promise<SuggestionDto[]> {
    const prefix = `${escapeLike(normalizeQuery(q))}%`;
    const own = await this.searches.query<{ query: string }[]>(
      `SELECT query FROM (
         SELECT DISTINCT ON (normalized_query) query, created_at
           FROM web_searches
          WHERE user_id = $1 AND normalized_query LIKE $2
          ORDER BY normalized_query, created_at DESC
       ) mine
       ORDER BY created_at DESC
       LIMIT ${SUGGESTION_LIMIT}`,
      [userId, prefix],
    );
    const suggestions: SuggestionDto[] = own.map((r) => ({
      query: r.query,
      source: 'HISTORY',
    }));
    if (suggestions.length >= SUGGESTION_LIMIT) {
      return suggestions;
    }

    const popular = await this.searches.query<{ normalized_query: string }[]>(
      `SELECT normalized_query
         FROM web_searches
        WHERE normalized_query LIKE $1
          AND created_at > now() - make_interval(days => ${POPULAR_WINDOW_DAYS})
        GROUP BY normalized_query
       HAVING count(DISTINCT user_id) >= ${POPULAR_MIN_USERS}
        ORDER BY count(*) DESC, normalized_query ASC
        LIMIT ${SUGGESTION_LIMIT * 2}`,
      [prefix],
    );
    const seen = new Set(own.map((r) => normalizeQuery(r.query)));
    for (const row of popular) {
      if (suggestions.length >= SUGGESTION_LIMIT) {
        break;
      }
      if (!seen.has(row.normalized_query)) {
        seen.add(row.normalized_query);
        suggestions.push({ query: row.normalized_query, source: 'POPULAR' });
      }
    }
    return suggestions;
  }

  /**
   * A real (non-cached) answer for the same normalized query and provider
   * within the TTL. Cached rows are skipped so the TTL can't be extended.
   */
  private async findCached(
    normalizedQuery: string,
    providerId: string,
  ): Promise<Pick<WebSearch, 'answer' | 'results'> | null> {
    if (this.cacheTtlSeconds <= 0) {
      return null;
    }
    return this.searches
      .createQueryBuilder('w')
      .select(['w.answer', 'w.results'])
      .where('w.normalized_query = :normalizedQuery', { normalizedQuery })
      .andWhere('w.provider_id = :providerId', { providerId })
      .andWhere('w.from_cache = false')
      .andWhere('w.created_at > now() - make_interval(secs => :ttl)', {
        ttl: this.cacheTtlSeconds,
      })
      .orderBy('w.created_at', 'DESC')
      .getOne();
  }

  private toItem(w: WebSearch): SearchHistoryItemDto {
    return {
      id: w.id,
      query: w.query,
      answer: w.answer,
      results: w.results,
      fromCache: w.fromCache,
      providerId: w.providerId,
      createdAt: w.createdAt,
    };
  }
}
