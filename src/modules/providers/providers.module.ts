import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggingModule } from '../logging/logging.module';
import { AdapterFactory } from './adapters/adapter.factory';
import { AdminProvidersController } from './controllers/admin-providers.controller';
import { ProvidersController } from './controllers/providers.controller';
import { AiProvider } from './entities/ai-provider.entity';
import { ProvidersService } from './providers.service';

@Module({
  imports: [TypeOrmModule.forFeature([AiProvider]), LoggingModule],
  controllers: [ProvidersController, AdminProvidersController],
  providers: [ProvidersService, AdapterFactory],
  exports: [ProvidersService],
})
export class ProvidersModule {}
