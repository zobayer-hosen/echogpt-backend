import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { ErrorCode } from '../constants/error-codes';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { AppException } from '../exceptions/app.exception';
import { RequestLoggingInterceptor } from '../interceptors/request-logging.interceptor';
import { AppRequest } from '../utils/request-context';

interface ErrorParts {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

const DEFAULT_CODES: Record<number, string> = {
  400: ErrorCode.VALIDATION_ERROR,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  429: ErrorCode.RATE_LIMITED,
};

const DEFAULT_MESSAGES: Record<number, string> = {
  401: 'Missing, invalid or expired access token',
  403: 'You do not have permission to do this',
  429: 'Too many requests, please slow down',
};

/** Renders every error in the one shape from PRD §7. Never leaks stacks. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  constructor(private readonly requestLogger: RequestLoggingInterceptor) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<AppRequest>();
    const res = ctx.getResponse<Response>();

    const parts = this.toParts(exception);
    if (parts.status >= 500) {
      const err = exception instanceof Error ? exception : undefined;
      this.logger.error(
        `${req.method} ${req.originalUrl.split('?')[0]} -> ${parts.code}: ${err?.message ?? 'unknown error'}`,
        err?.stack,
      );
    }

    if (res.headersSent) {
      // e.g. a stream already started: just close it
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }

    const requestId = req.requestId ?? randomUUID();
    if (!req.requestId) {
      req.requestId = requestId;
      res.setHeader('x-request-id', requestId);
    }
    this.requestLogger.track(req, res);

    const body: ErrorResponseDto = {
      statusCode: parts.status,
      code: parts.code,
      message: parts.message,
      ...(parts.details ? { details: parts.details } : {}),
      timestamp: new Date().toISOString(),
      path: req.originalUrl.split('?')[0],
      requestId,
    };
    res.status(parts.status).json(body);
  }

  private toParts(exception: unknown): ErrorParts {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        code: ErrorCode.RATE_LIMITED,
        message: DEFAULT_MESSAGES[429],
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code: this.codeFor(status),
        message: this.messageFor(status, exception),
      };
    }

    // body-parser errors (bad JSON, body too large) carry a numeric status
    const status = this.statusOf(exception);
    if (status && status >= 400 && status < 500) {
      return {
        status,
        code: this.codeFor(status),
        message:
          status === 400
            ? 'Malformed request body'
            : (HttpStatus[status] ?? 'Bad request'),
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    };
  }

  private codeFor(status: number): string {
    if (status >= 500) {
      return ErrorCode.INTERNAL_ERROR;
    }
    return DEFAULT_CODES[status] ?? HttpStatus[status] ?? 'HTTP_ERROR';
  }

  private messageFor(status: number, exception: HttpException): string {
    if (status >= 500) {
      return 'Internal server error';
    }
    if (DEFAULT_MESSAGES[status] && status !== 404) {
      const response = exception.getResponse();
      const custom =
        typeof response === 'object' &&
        response !== null &&
        'message' in response &&
        typeof response.message === 'string' &&
        response.message !== HttpStatus[status] &&
        response.message !== 'Unauthorized' &&
        response.message !== 'Forbidden resource';
      return custom ? exception.message : DEFAULT_MESSAGES[status];
    }
    return exception.message;
  }

  private statusOf(exception: unknown): number | undefined {
    if (typeof exception === 'object' && exception !== null) {
      const candidate =
        (exception as { status?: unknown }).status ??
        (exception as { statusCode?: unknown }).statusCode;
      return typeof candidate === 'number' ? candidate : undefined;
    }
    return undefined;
  }
}
