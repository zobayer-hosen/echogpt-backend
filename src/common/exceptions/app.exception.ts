import { HttpException, HttpStatus, ValidationError } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';

/** A business error with a stable code; rendered by AllExceptionsFilter. */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: ErrorCode | string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }

  static notFound(what: string): AppException {
    return new AppException(
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      `${what} not found`,
    );
  }

  /** Used as ValidationPipe `exceptionFactory`: `{ field: [messages] }`. */
  static fromValidationErrors(errors: ValidationError[]): AppException {
    const fields: Record<string, string[]> = {};
    const walk = (list: ValidationError[], prefix: string) => {
      for (const error of list) {
        const path = prefix ? `${prefix}.${error.property}` : error.property;
        if (error.constraints) {
          fields[path] = Object.values(error.constraints);
        }
        if (error.children?.length) {
          walk(error.children, path);
        }
      }
    };
    walk(errors, '');
    return new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      'Validation failed',
      fields,
    );
  }
}
