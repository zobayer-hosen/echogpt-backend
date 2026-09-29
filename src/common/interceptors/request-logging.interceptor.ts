import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { ApiUsageLogService } from '../../modules/logging/api-usage-log.service';
import { AppRequest, RequestContext } from '../utils/request-context';

/**
 * One log line and one `api_usage_logs` row per request, written when the
 * response finishes. Requests rejected before interceptors run (guards,
 * unknown routes) are handed over by AllExceptionsFilter through `track()`.
 * Bodies and query strings are never stored.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  private readonly tracked = new WeakSet<AppRequest>();

  constructor(private readonly usageLogs: ApiUsageLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const http = context.switchToHttp();
      this.track(http.getRequest<AppRequest>(), http.getResponse<Response>());
    }
    return next.handle();
  }

  track(req: AppRequest, res: Response): void {
    if (this.tracked.has(req)) {
      return;
    }
    this.tracked.add(req);
    // captured now: the 'finish' callback may run outside the async context
    const store = RequestContext.get();
    const startedAt = store?.startedAt ?? Date.now();

    res.once('finish', () => {
      const durationMs = Date.now() - startedAt;
      const path = req.originalUrl.split('?')[0];
      this.logger.log(
        `${req.method} ${path} ${res.statusCode} ${durationMs}ms rid=${req.requestId ?? '-'}`,
      );
      this.usageLogs.record({
        userId: req.user?.id ?? null,
        method: req.method,
        path,
        statusCode: res.statusCode,
        durationMs,
        ipAddress: req.ip ?? null,
        feature: store?.ai?.feature ?? null,
        providerId: store?.ai?.providerId ?? null,
        aiSuccess: store?.ai?.success ?? null,
      });
    });
  }
}
