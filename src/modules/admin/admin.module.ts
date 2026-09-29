import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { LoggingModule } from '../logging/logging.module';
import { ProvidersModule } from '../providers/providers.module';
import { SearchModule } from '../search/search.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { UsersModule } from '../users/users.module';
import { AdminStatsService } from './admin-stats.service';
import { AnalyticsController } from './controllers/analytics.controller';
import { DashboardController } from './controllers/dashboard.controller';
import { LogsController } from './controllers/logs.controller';
import { SystemHealthController } from './controllers/system-health.controller';

/** Cross-module admin views only; feature admin routes live in their modules. */
@Module({
  imports: [
    UsersModule,
    SubscriptionsModule,
    ChatModule,
    SearchModule,
    ProvidersModule,
    LoggingModule,
  ],
  controllers: [
    DashboardController,
    AnalyticsController,
    LogsController,
    SystemHealthController,
  ],
  providers: [AdminStatsService],
})
export class AdminModule {}
