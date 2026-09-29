import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-codes';
import { buildPlans, PlanInfo } from '../../common/constants/plans';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PlanCode } from '../../common/enums/plan-code.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { pageOffset, toPage } from '../../common/utils/pagination.util';
import { AppConfig } from '../../config/configuration';
import {
  AdminSubscriptionDto,
  AdminSubscriptionsQueryDto,
  PlanDto,
  SubscriptionDto,
  UsageDto,
} from './dto/subscription.dto';
import { Subscription } from './entities/subscription.entity';

interface UsageRow {
  plan: PlanCode;
  used: number;
  resets_at: Date;
}

/** today's count, or 0 if the stored counter belongs to an earlier day */
const USED_TODAY =
  'CASE WHEN s.usage_date = CURRENT_DATE THEN s.requests_used ELSE 0 END';
/** start of the next UTC day (connections run in UTC) */
const NEXT_RESET = '(CURRENT_DATE + 1)::timestamptz';

/** Owns `subscriptions`: plans, plan changes and the daily usage counter. */
@Injectable()
export class SubscriptionsService {
  private readonly plans: Record<PlanCode, PlanInfo>;

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
    config: ConfigService<AppConfig, true>,
  ) {
    this.plans = buildPlans(config.get('plans', { infer: true }));
  }

  listPlans(): PlanDto[] {
    return Object.values(this.plans);
  }

  limitFor(plan: PlanCode): number {
    return this.plans[plan].dailyLimit;
  }

  /** Every new user starts on FREE (PRD A7); runs inside the register transaction. */
  async createFree(manager: EntityManager, userId: string): Promise<void> {
    await manager.insert(Subscription, { userId, plan: PlanCode.FREE });
  }

  async getPlan(userId: string): Promise<PlanCode> {
    return (await this.findOrFail(userId)).plan;
  }

  async getStatus(userId: string): Promise<SubscriptionDto> {
    return this.toStatus(await this.findOrFail(userId));
  }

  /** Simulated, immediate upgrade/downgrade (PRD A4, SU-3). Usage is kept. */
  async changePlan(userId: string, plan: PlanCode): Promise<SubscriptionDto> {
    const subscription = await this.findOrFail(userId);
    if (subscription.plan === plan) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.ALREADY_ON_PLAN,
        `Already on the ${this.plans[plan].name} plan`,
      );
    }
    await this.subscriptions.update(
      { userId },
      { plan, startedAt: new Date() },
    );
    return this.getStatus(userId);
  }

  async getUsage(userId: string): Promise<UsageDto> {
    const row = await this.subscriptions
      .createQueryBuilder('s')
      .select('s.plan', 'plan')
      .addSelect(USED_TODAY, 'used')
      .addSelect(NEXT_RESET, 'resets_at')
      .where('s.user_id = :userId', { userId })
      .getRawOne<UsageRow>();
    if (!row) {
      throw AppException.notFound('Subscription');
    }
    return this.toUsage(row.plan, Number(row.used), row.resets_at);
  }

  /**
   * Counts one request and checks the limit in ONE atomic UPDATE (ERD §3).
   * Postgres row locking makes concurrent calls at `limit - 1` let exactly
   * one through. Throws 429 USAGE_LIMIT_EXCEEDED when the limit is reached.
   */
  async useRequest(userId: string): Promise<UsageDto> {
    const result = await this.subscriptions
      .createQueryBuilder()
      .update(Subscription)
      .set({
        requestsUsed: () =>
          'CASE WHEN usage_date = CURRENT_DATE THEN requests_used + 1 ELSE 1 END',
        usageDate: () => 'CURRENT_DATE',
      })
      .where('user_id = :userId', { userId })
      .andWhere(
        `(usage_date <> CURRENT_DATE OR requests_used < CASE plan WHEN 'PREMIUM' THEN CAST(:premiumLimit AS int) ELSE CAST(:freeLimit AS int) END)`,
        {
          freeLimit: this.limitFor(PlanCode.FREE),
          premiumLimit: this.limitFor(PlanCode.PREMIUM),
        },
      )
      .returning(`plan, requests_used AS used, ${NEXT_RESET} AS resets_at`)
      .execute();

    const [row] = result.raw as UsageRow[];
    if (row) {
      return this.toUsage(row.plan, Number(row.used), row.resets_at);
    }

    const usage = await this.getUsage(userId);
    throw new AppException(
      HttpStatus.TOO_MANY_REQUESTS,
      ErrorCode.USAGE_LIMIT_EXCEEDED,
      `Daily limit of ${usage.limit} requests reached`,
      {
        limit: usage.limit,
        used: usage.used,
        remaining: 0,
        resetsAt: usage.resetsAt,
      },
    );
  }

  /** A failed AI call doesn't use up quota (PRD A8). */
  async giveBackRequest(userId: string): Promise<UsageDto> {
    await this.subscriptions
      .createQueryBuilder()
      .update(Subscription)
      .set({ requestsUsed: () => 'requests_used - 1' })
      .where('user_id = :userId', { userId })
      .andWhere('usage_date = CURRENT_DATE')
      .andWhere('requests_used > 0')
      .execute();
    return this.getUsage(userId);
  }

  // ---- admin ----

  async listForAdmin(
    query: AdminSubscriptionsQueryDto,
  ): Promise<Paginated<AdminSubscriptionDto>> {
    const qb = this.subscriptions
      .createQueryBuilder('s')
      .innerJoin('s.user', 'u', 'u.deleted_at IS NULL')
      .select([
        's.user_id AS user_id',
        'u.email AS email',
        'u.full_name AS full_name',
        's.plan AS plan',
        's.started_at AS started_at',
        `${USED_TODAY} AS used`,
      ]);
    if (query.plan) {
      qb.andWhere('s.plan = :plan', { plan: query.plan });
    }
    const total = await qb.getCount();
    const rows = await qb
      .orderBy('u.email', 'ASC')
      .offset(pageOffset(query))
      .limit(query.limit)
      .getRawMany<{
        user_id: string;
        email: string;
        full_name: string;
        plan: PlanCode;
        started_at: Date;
        used: number;
      }>();
    return toPage(
      rows.map((r) =>
        this.toAdminView(
          r.user_id,
          r.email,
          r.full_name,
          r.plan,
          r.started_at,
          Number(r.used),
        ),
      ),
      total,
      query,
    );
  }

  async getForAdmin(userId: string): Promise<AdminSubscriptionDto> {
    const row = await this.subscriptions
      .createQueryBuilder('s')
      .innerJoin('s.user', 'u', 'u.deleted_at IS NULL')
      .select([
        'u.email AS email',
        'u.full_name AS full_name',
        's.plan AS plan',
        's.started_at AS started_at',
        `${USED_TODAY} AS used`,
      ])
      .where('s.user_id = :userId', { userId })
      .getRawOne<{
        email: string;
        full_name: string;
        plan: PlanCode;
        started_at: Date;
        used: number;
      }>();
    if (!row) {
      throw AppException.notFound('User');
    }
    return this.toAdminView(
      userId,
      row.email,
      row.full_name,
      row.plan,
      row.started_at,
      Number(row.used),
    );
  }

  async changePlanByAdmin(
    userId: string,
    plan: PlanCode,
  ): Promise<AdminSubscriptionDto> {
    await this.getForAdmin(userId); // 404 for unknown or deleted users
    await this.changePlan(userId, plan);
    return this.getForAdmin(userId);
  }

  /** Active (non-deleted) users per plan, for the admin dashboard. */
  async countByPlan(): Promise<Record<PlanCode, number>> {
    const rows = await this.subscriptions
      .createQueryBuilder('s')
      .innerJoin('s.user', 'u', 'u.deleted_at IS NULL')
      .select('s.plan', 'plan')
      .addSelect('count(*)::int', 'count')
      .groupBy('s.plan')
      .getRawMany<{ plan: PlanCode; count: number }>();
    const counts = { [PlanCode.FREE]: 0, [PlanCode.PREMIUM]: 0 };
    for (const row of rows) {
      counts[row.plan] = row.count;
    }
    return counts;
  }

  private async findOrFail(userId: string): Promise<Subscription> {
    const subscription = await this.subscriptions.findOne({
      where: { userId },
    });
    if (!subscription) {
      throw AppException.notFound('Subscription');
    }
    return subscription;
  }

  private toStatus(subscription: Subscription): SubscriptionDto {
    const plan = this.plans[subscription.plan];
    return {
      plan: plan.code,
      planName: plan.name,
      dailyLimit: plan.dailyLimit,
      price: plan.price,
      startedAt: subscription.startedAt,
    };
  }

  /** Downgrading below today's usage gives `remaining = 0`, never negative. */
  private toUsage(plan: PlanCode, used: number, resetsAt: Date): UsageDto {
    const limit = this.limitFor(plan);
    return {
      plan,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      resetsAt: new Date(resetsAt),
    };
  }

  private toAdminView(
    userId: string,
    email: string,
    fullName: string,
    plan: PlanCode,
    startedAt: Date,
    used: number,
  ): AdminSubscriptionDto {
    const limit = this.limitFor(plan);
    return {
      userId,
      email,
      fullName,
      plan,
      dailyLimit: limit,
      startedAt,
      usedToday: used,
      remainingToday: Math.max(0, limit - used),
    };
  }
}
