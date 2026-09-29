import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-codes';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { HealthStatus } from '../../common/enums/health-status.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { pageOffset, toPage } from '../../common/utils/pagination.util';
import { ChatService } from '../chat/chat.service';
import {
  ApiUsageLogService,
  toAnalyticsRow,
} from '../logging/api-usage-log.service';
import { ProvidersService } from '../providers/providers.service';
import { SearchService } from '../search/search.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { UsersService } from '../users/users.service';
import {
  DashboardDto,
  DateRangeQueryDto,
  RequestLogDto,
  RequestLogsQueryDto,
  SystemHealthDto,
  UsageAnalyticsDto,
  UsageAnalyticsQueryDto,
} from './dto/admin.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;
const toMb = (bytes: number) => Math.round(bytes / 1024 / 1024);

/**
 * Cross-module admin views (PRD §10: the admin module only reads, through
 * each module's exported service).
 */
@Injectable()
export class AdminStatsService {
  constructor(
    private readonly users: UsersService,
    private readonly subscriptions: SubscriptionsService,
    private readonly chat: ChatService,
    private readonly search: SearchService,
    private readonly providers: ProvidersService,
    private readonly usageLogs: ApiUsageLogService,
    private readonly dataSource: DataSource,
  ) {}

  /** PRD AD-1. */
  async dashboard(): Promise<DashboardDto> {
    const [userStats, byPlan, http, chat, search, ai, providers] =
      await Promise.all([
        this.users.countStats(),
        this.subscriptions.countByPlan(),
        this.usageLogs.countRequestsToday(),
        this.chat.countPromptsToday(),
        this.search.countToday(),
        this.usageLogs.aiStats(24),
        this.providers.listHealth(),
      ]);
    return {
      users: { ...userStats, byPlan },
      requestsToday: { http, chat, search },
      aiLast24h: {
        ...ai,
        errorRate: ai.calls
          ? Math.round((ai.errors / ai.calls) * 10000) / 10000
          : 0,
      },
      providers,
      generatedAt: new Date(),
    };
  }

  /** PRD AD-5. */
  async usage(query: UsageAnalyticsQueryDto): Promise<UsageAnalyticsDto> {
    const { from, to } = this.range(query);
    const rows = await this.usageLogs.usageAnalytics(from, to, query.groupBy);
    const requests = rows.reduce((sum, r) => sum + r.requests, 0);
    const successes = rows.reduce((sum, r) => sum + r.successes, 0);
    const latencySum = rows.reduce(
      (sum, r) => sum + r.avgLatencyMs * r.requests,
      0,
    );
    return {
      from,
      to,
      groupBy: query.groupBy,
      totals: toAnalyticsRow(
        null,
        'all',
        requests,
        successes,
        requests ? Math.round(latencySum / requests) : 0,
      ),
      rows,
    };
  }

  /** PRD AD-6. */
  async requestLogs(
    query: RequestLogsQueryDto,
  ): Promise<Paginated<RequestLogDto>> {
    const { rows, total } = await this.usageLogs.listRequests({
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      status: query.status,
      userId: query.userId,
      path: query.path,
      offset: pageOffset(query),
      limit: query.limit,
    });
    return toPage(
      rows.map((l) => ({
        id: l.id,
        method: l.method,
        path: l.path,
        statusCode: l.statusCode,
        durationMs: l.durationMs,
        ipAddress: l.ipAddress,
        userId: l.userId,
        feature: l.feature,
        providerId: l.providerId,
        aiSuccess: l.aiSuccess,
        createdAt: l.createdAt,
      })),
      total,
      query,
    );
  }

  /** PRD AD-7: DB ping, uptime, memory, Node version, provider statuses. */
  async systemHealth(): Promise<SystemHealthDto> {
    const started = Date.now();
    let database: SystemHealthDto['database'];
    try {
      await this.dataSource.query('SELECT 1');
      database = { status: 'up', latencyMs: Date.now() - started };
    } catch {
      database = { status: 'down', latencyMs: null };
    }
    const providers =
      database.status === 'up' ? await this.providers.listHealth() : [];
    const defaultDown = providers.some(
      (p) => p.isDefault && p.healthStatus === HealthStatus.DOWN,
    );
    const memory = process.memoryUsage();
    return {
      status: database.status === 'up' && !defaultDown ? 'ok' : 'degraded',
      database,
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        rssMb: toMb(memory.rss),
        heapUsedMb: toMb(memory.heapUsed),
        heapTotalMb: toMb(memory.heapTotal),
      },
      nodeVersion: process.version,
      providers,
      checkedAt: new Date(),
    };
  }

  private range(query: DateRangeQueryDto): { from: Date; to: Date } {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 7 * DAY_MS);
    if (from >= to) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        '`from` must be before `to`',
        { from: ['must be before to'] },
      );
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        `The range can be at most ${MAX_RANGE_DAYS} days`,
        { from: [`range must be at most ${MAX_RANGE_DAYS} days`] },
      );
    }
    return { from, to };
  }
}
