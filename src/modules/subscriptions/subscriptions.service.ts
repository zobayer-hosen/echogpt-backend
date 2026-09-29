import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PlanCode } from '../../common/enums/plan-code.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { Subscription } from './entities/subscription.entity';

/** Owns `subscriptions`: plans, plan changes and the daily usage counter. */
@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
  ) {}

  /** Every new user starts on FREE (PRD A7); runs inside the register transaction. */
  async createFree(manager: EntityManager, userId: string): Promise<void> {
    await manager.insert(Subscription, { userId, plan: PlanCode.FREE });
  }

  async getPlan(userId: string): Promise<PlanCode> {
    const subscription = await this.subscriptions.findOne({
      where: { userId },
      select: { id: true, plan: true },
    });
    if (!subscription) {
      throw AppException.notFound('Subscription');
    }
    return subscription.plan;
  }
}
