import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse } from '@nestjs/swagger';
import { ErrorCode } from '../constants/error-codes';
import { ErrorResponseDto } from '../dto/error-response.dto';

export interface ApiErrorSpec {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

const spec = (
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ApiErrorSpec => ({ status, code, message, details });

/** Catalog of documented errors; routes pick the ones they can return. */
export const ApiError = {
  validation: (details: Record<string, unknown> = { field: ['is invalid'] }) =>
    spec(400, ErrorCode.VALIDATION_ERROR, 'Validation failed', details),
  unauthorized: spec(
    401,
    ErrorCode.UNAUTHORIZED,
    'Missing, invalid or expired access token',
  ),
  forbidden: spec(403, ErrorCode.FORBIDDEN, 'Admin role required'),
  notFound: (what: string) =>
    spec(404, ErrorCode.NOT_FOUND, `${what} not found`),
  custom: spec,
};

const ALWAYS: ApiErrorSpec[] = [
  spec(429, ErrorCode.RATE_LIMITED, 'Too many requests, please slow down'),
  spec(500, ErrorCode.INTERNAL_ERROR, 'Internal server error'),
];

const exampleBody = (s: ApiErrorSpec): ErrorResponseDto => ({
  statusCode: s.status,
  code: s.code,
  message: s.message,
  ...(s.details ? { details: s.details } : {}),
  timestamp: '2026-09-29T10:15:00.000Z',
  path: '/api/v1/…',
  requestId: '0d9c4e62-3a8e-4b8e-9a53-3f1f0f2f1a11',
});

/**
 * Documents every error a route can return with the shared ErrorResponseDto.
 * 429 RATE_LIMITED and 500 INTERNAL_ERROR are added to every route.
 */
export function ApiErrorResponses(
  ...specs: ApiErrorSpec[]
): MethodDecorator & ClassDecorator {
  const byStatus = new Map<number, ApiErrorSpec[]>();
  for (const s of [...specs, ...ALWAYS]) {
    const list = byStatus.get(s.status) ?? [];
    if (!list.some((existing) => existing.code === s.code)) {
      list.push(s);
    }
    byStatus.set(s.status, list);
  }

  const decorators = [...byStatus.entries()]
    .sort(([a], [b]) => a - b)
    .map(([status, list]) =>
      ApiResponse({
        status,
        description: list.map((s) => `${s.code}: ${s.message}`).join(' | '),
        type: ErrorResponseDto,
        examples: Object.fromEntries(
          list.map((s) => [
            s.code,
            { summary: s.message, value: exampleBody(s) },
          ]),
        ),
      }),
    );

  return applyDecorators(ApiExtraModels(ErrorResponseDto), ...decorators);
}
