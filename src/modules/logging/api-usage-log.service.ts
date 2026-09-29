import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  /** Waits for writes still in flight (used on shutdown and in tests). */
  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  /** Runs before TypeORM closes its connection. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.flush();
  }
}
