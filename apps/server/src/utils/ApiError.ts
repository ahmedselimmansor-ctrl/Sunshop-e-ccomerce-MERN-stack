import { ERROR_CODES, type ErrorCode } from '@sunshop/shared';

export interface FieldIssue {
  path: string;
  message: string;
  code?: string;
}

/**
 * The only error type the HTTP layer knows how to render.
 *
 * `message` is a *translation key* (e.g. `errors.out_of_stock`), not English
 * prose: the error handler localizes it against the request's locale. Anything
 * that must not reach the client (a Mongo duplicate-key detail, a Stripe raw
 * message) goes in `internal`, which is logged and never serialized.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: FieldIssue[];
  readonly retryAfter?: number;
  readonly internal?: unknown;
  /** False for genuine bugs, which alerting treats differently from 4xx. */
  readonly isOperational: boolean;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    options: {
      details?: FieldIssue[];
      retryAfter?: number;
      internal?: unknown;
      isOperational?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.retryAfter = options.retryAfter;
    this.internal = options.internal;
    this.isOperational = options.isOperational ?? true;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'errors.bad_request', details?: FieldIssue[]) {
    return new ApiError(400, ERROR_CODES.VALIDATION_ERROR, message, { details });
  }

  static validation(details: FieldIssue[], message = 'errors.validation_failed') {
    return new ApiError(422, ERROR_CODES.VALIDATION_ERROR, message, { details });
  }

  static unauthorized(message = 'errors.unauthorized', code: ErrorCode = ERROR_CODES.UNAUTHORIZED) {
    return new ApiError(401, code, message);
  }

  static forbidden(message = 'errors.forbidden') {
    return new ApiError(403, ERROR_CODES.FORBIDDEN, message);
  }

  static notFound(message = 'errors.not_found') {
    return new ApiError(404, ERROR_CODES.NOT_FOUND, message);
  }

  static conflict(
    message = 'errors.conflict',
    details?: FieldIssue[],
    code: ErrorCode = ERROR_CODES.CONFLICT,
  ) {
    return new ApiError(409, code, message, { details });
  }

  static gone(message = 'errors.gone') {
    return new ApiError(410, ERROR_CODES.NOT_FOUND, message);
  }

  static payloadTooLarge(message = 'errors.payload_too_large') {
    return new ApiError(413, ERROR_CODES.PAYLOAD_TOO_LARGE, message);
  }

  static unsupportedMediaType(message = 'errors.unsupported_media_type') {
    return new ApiError(415, ERROR_CODES.UNSUPPORTED_MEDIA_TYPE, message);
  }

  static rateLimited(retryAfter: number, message = 'errors.rate_limited') {
    return new ApiError(429, ERROR_CODES.RATE_LIMITED, message, { retryAfter });
  }

  static internal(message = 'errors.internal', internal?: unknown) {
    return new ApiError(500, ERROR_CODES.INTERNAL_ERROR, message, {
      internal,
      isOperational: false,
    });
  }

  static unavailable(message = 'errors.service_unavailable', retryAfter = 30) {
    return new ApiError(503, ERROR_CODES.SERVICE_UNAVAILABLE, message, { retryAfter });
  }

  static outOfStock(details?: FieldIssue[]) {
    return new ApiError(409, ERROR_CODES.OUT_OF_STOCK, 'errors.out_of_stock', { details });
  }

  static invalidTransition(from: string, to: string) {
    return new ApiError(409, ERROR_CODES.INVALID_STATE_TRANSITION, 'errors.invalid_transition', {
      details: [{ path: 'status', message: `${from} → ${to}` }],
    });
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
