import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import { AppRequest, RequestContext } from '../utils/request-context';

const SAFE_ID = /^[\w.-]{1,64}$/;

/**
 * Gives every request an id (`x-request-id`, reused from the client when safe)
 * and opens the per-request context.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: AppRequest, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && SAFE_ID.test(incoming)
        ? incoming
        : randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    RequestContext.run(
      {
        requestId,
        startedAt: Date.now(),
        method: req.method,
        path: req.originalUrl.split('?')[0],
        ip: req.ip ?? null,
      },
      () => next(),
    );
  }
}
