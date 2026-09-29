import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsageFeature } from '../../common/enums/usage-feature.enum';
import { escapeLike } from '../../common/utils/pagination.util';
import { RequestContext } from '../../common/utils/request-context';
import { ApiUsageLog } from './entities/api-usage-log.entity';

export type ApiUsageLogEntry = Pick<
  ApiUsageLog,
  | 'userId'
  | 'method'
  | 'path'
  | 'statusCode'
  | 'durationMs'
  | 'ipAddress'
  | 'feature'
  | 'providerId'
  | 'aiSuccess'
>;

export type AnalyticsGrouping = 'day' | 'provider' | 'feature';

export interface UsageAnalyticsRow {
  key: string | null;
  label: string;
  requests: number;
  successes: number;
  failures: number;
  successRate: number;
  avgLatencyMs: number;
}

export interface RequestLogFilter {
  from?: Date;
  to?: Date;
  status?: number;
  userId?: string;
  path?: string;
  offset: number;
  limit: number;
}

/** SQL for each grouping; only these fixed strings reach the query. */
const GROUPINGS: Record<AnalyticsGrouping, { key: string; label: string }> = {
  day: {
    key: `to_char(l.created_at, 'YYYY-MM-DD')`,
    label: `to_char(l.created_at, 'YYYY-MM-DD')`,
  },
  provider: {
    key: 'l.provider_id::text',
    label: `coalesce(p.name, '(deleted provider)')`,
  },
  feature: { key: 'l.feature', label: 'l.feature' },
};

export function toAnalyticsRow(
  key: string | null,
  label: string,
  requests: number,
  successes: number,
  avgLatencyMs: number | null,
): UsageAnalyticsRow {
  return {
    key,
    label,
    requests,
    successes,
    failures: requests - successes,
    successRate: requests
      ? Math.round((successes / requests) * 10000) / 10000
      : 0,
    avgLatencyMs: avgLatencyMs ?? 0,
  };
}

/** Owns `api_usage_logs`: writes request rows, serves analytics queries. */
@Injectable()
export class ApiUsageLogService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(ApiUsageLogService.name);
  private readonly pending = new Set<Promise<void>>();

  constructor(
    @InjectRepository(ApiUsageLog)
    private readonly logs: Repository<ApiUsageLog>,
  ) {}

  /** Fire-and-forget: a failed log write never fails the request. */
  record(entry: ApiUsageLogEntry): void {
    const write = this.logs
      .insert({
        ...entry,
        method: entry.method.slice(0, 10),
        path: entry.path.slice(0, 500),
        ipAddress: entry.ipAddress?.slice(0, 64) ?? null,
      })
      .then(() => undefined)
      .catch((error: unknown) => {
        this.logger.warn(
          `Could not write api_usage_logs row: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      })
      .finally(() => this.pending.delete(write));
    this.pending.add(write);
  }

  /**
   * Extra row for an AI call that is not the request's own single AI call
   * (e.g. one row per provider in "check all providers").
   */
  recordAiCall(call: {
    userId: string | null;
    feature: UsageFeature;
    providerId: string;
    success: boolean;
    durationMs: number;
  }): void {
    const store = RequestContext.get();
    this.record({
      userId: call.userId,
      method: store?.method ?? 'INTERNAL',
      path: store?.path ?? '-',
      statusCode: 200,
      durationMs: call.durationMs,
      ipAddress: store?.ip ?? null,
      feature: call.feature,
      providerId: call.providerId,
      aiSuccess: call.success,
    });
  }

  // ---- reads for the admin panel ----

  /** HTTP requests since 00:00 UTC. */
  countRequestsToday(): Promise<number> {
    return this.logs
      .createQueryBuilder('l')
      .where('l.created_at >= CURRENT_DATE')
      .getCount();
  }

  /** AI provider calls and failures in the last `hours` hours. */
  async aiStats(hours: number): Promise<{ calls: number; errors: number }> {
    const [row] = await this.logs.query<{ calls: number; errors: number }[]>(
      `SELECT count(*)::int AS calls,
              (count(*) FILTER (WHERE NOT ai_success))::int AS errors
         FROM api_usage_logs
        WHERE ai_success IS NOT NULL
          AND created_at >= now() - make_interval(hours => $1)`,
      [hours],
    );
    return row;
  }

  /**
   * AI calls grouped by day, provider or feature: counts, success rate and
   * average latency (PRD AD-5). `groupBy` comes from a fixed list.
   */
  async usageAnalytics(
    from: Date,
    to: Date,
    groupBy: AnalyticsGrouping,
  ): Promise<UsageAnalyticsRow[]> {
    const { key, label } = GROUPINGS[groupBy];
    const rows = await this.logs.query<
      {
        key: string | null;
        label: string;
        requests: number;
        successes: number;
        avg_latency_ms: number | null;
      }[]
    >(
      `SELECT ${key} AS key, ${label} AS label,
              count(*)::int AS requests,
              (count(*) FILTER (WHERE l.ai_success))::int AS successes,
              round(avg(l.duration_ms))::int AS avg_latency_ms
         FROM api_usage_logs l
         LEFT JOIN ai_providers p ON p.id = l.provider_id
        WHERE l.ai_success IS NOT NULL
          AND l.created_at >= $1 AND l.created_at < $2
        GROUP BY 1, 2
        ORDER BY 1`,
      [from, to],
    );
    return rows.map((r) =>
      toAnalyticsRow(r.key, r.label, r.requests, r.successes, r.avg_latency_ms),
    );
  }

  /** Newest first, filtered (PRD AD-6). */
  async listRequests(filter: RequestLogFilter): Promise<{
    rows: ApiUsageLog[];
    total: number;
  }> {
    const qb = this.logs.createQueryBuilder('l');
    if (filter.from) {
      qb.andWhere('l.created_at >= :from', { from: filter.from });
    }
    if (filter.to) {
      qb.andWhere('l.created_at < :to', { to: filter.to });
    }
    if (filter.status) {
      qb.andWhere('l.status_code = :status', { status: filter.status });
    }
    if (filter.userId) {
      qb.andWhere('l.user_id = :userId', { userId: filter.userId });
    }
    if (filter.path) {
      qb.andWhere('l.path ILIKE :path', {
        path: `%${escapeLike(filter.path)}%`,
      });
    }
    const [rows, total] = await qb
      .orderBy('l.created_at', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .skip(filter.offset)
      .take(filter.limit)
      .getManyAndCount();
    return { rows, total };
  }

  /** Waits for writes still in flight (used on shutdown and in tests). */
  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  /** Runs before TypeORM closes its connection. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.flush();
  }
}
