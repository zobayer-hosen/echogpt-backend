import { PlanCode } from '../enums/plan-code.enum';

export interface PlanInfo {
  code: PlanCode;
  name: string;
  /** requests (chat messages + searches) per UTC day */
  dailyLimit: number;
  /** shown only; upgrades are simulated (PRD §2) */
  price: number;
  currency: 'USD';
  billingPeriod: 'month';
}

/** Plan details live in config, not in a table (ERD §2). */
export function buildPlans(limits: {
  freeDailyLimit: number;
  premiumDailyLimit: number;
}): Record<PlanCode, PlanInfo> {
  return {
    [PlanCode.FREE]: {
      code: PlanCode.FREE,
      name: 'Free',
      dailyLimit: limits.freeDailyLimit,
      price: 0,
      currency: 'USD',
      billingPeriod: 'month',
    },
    [PlanCode.PREMIUM]: {
      code: PlanCode.PREMIUM,
      name: 'Premium',
      dailyLimit: limits.premiumDailyLimit,
      price: 9.99,
      currency: 'USD',
      billingPeriod: 'month',
    },
  };
}
