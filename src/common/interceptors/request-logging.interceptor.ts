import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { AppRequest, RequestContext } from '../utils/request-context';

/**
 * One log line per request, written when the response finishes.
 * Requests rejected before interceptors run (guards, unknown routes) are
 * tracked by AllExceptionsFilter through `track()`.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  private readonly tracked = new WeakSet<AppRequest>();

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
    const store = RequestContext.get();
    const startedAt = store?.startedAt ?? Date.now();
    res.once('finish', () => {
      const durationMs = Date.now() - startedAt;
      const path = req.originalUrl.split('?')[0];
      this.logger.log(
        `${req.method} ${path} ${res.statusCode} ${durationMs}ms rid=${req.requestId ?? '-'}`,
      );
    });
  }
}
