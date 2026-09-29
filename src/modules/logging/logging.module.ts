import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiUsageLogService } from './api-usage-log.service';
import { ApiUsageLog } from './entities/api-usage-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ApiUsageLog])],
  providers: [ApiUsageLogService],
  exports: [ApiUsageLogService],
})
export class LoggingModule {}
