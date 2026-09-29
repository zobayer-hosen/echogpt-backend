import {
  ArgumentsHost,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ErrorCode } from '../constants/error-codes';
import { AppException } from '../exceptions/app.exception';
import { RequestLoggingInterceptor } from '../interceptors/request-logging.interceptor';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const res = {
    headersSent: false,
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
    once: jest.fn(),
    json,
  };
  const req = {
    method: 'GET',
    originalUrl: '/api/v1/x?q=1',
    requestId: 'rid-1',
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  const tracker = { track: jest.fn() } as unknown as RequestLoggingInterceptor;
  const filter = new AllExceptionsFilter(tracker);
  jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  filter.catch(exception, host);
  return { status: res.status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

describe('AllExceptionsFilter', () => {
  it('renders AppException with code and details', () => {
    const { status, body } = run(
      new AppException(HttpStatus.CONFLICT, ErrorCode.EMAIL_TAKEN, 'Taken', {
        email: 'a@b.c',
      }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({
      statusCode: 409,
      code: 'EMAIL_TAKEN',
      message: 'Taken',
      details: { email: 'a@b.c' },
      path: '/api/v1/x',
      requestId: 'rid-1',
    });
  });

  it('maps plain HttpExceptions to default codes', () => {
    expect(run(new NotFoundException('Nope')).body.code).toBe('NOT_FOUND');
    const unauthorized = run(new UnauthorizedException()).body;
    expect(unauthorized.code).toBe('UNAUTHORIZED');
    expect(unauthorized.message).toBe(
      'Missing, invalid or expired access token',
    );
  });

  it('maps throttling to RATE_LIMITED', () => {
    const { status, body } = run(new ThrottlerException());
    expect(status).toBe(429);
    expect(body.code).toBe('RATE_LIMITED');
  });

  it('hides unknown errors behind INTERNAL_ERROR without a stack', () => {
    const { status, body } = run(new Error('db password is hunter2'));
    expect(status).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(body.stack).toBeUndefined();
  });

  it('builds validation details from class-validator errors', () => {
    const error = AppException.fromValidationErrors([
      {
        property: 'email',
        constraints: { isEmail: 'email must be an email' },
        children: [],
      },
    ]);
    const { status, body } = run(error);
    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details).toEqual({ email: ['email must be an email'] });
  });
});
