import { ERROR_CODES } from '@sunshop/shared';
import { Error as MongooseError } from 'mongoose';
import { ZodError } from 'zod';

import { isProduction } from '../config/env';
import { translate, translateField } from '../i18n/messages';
import { logger } from '../observability/logger';
import { ApiError, isApiError, type FieldIssue } from '../utils/ApiError';

import type { NextFunction, Request, Response } from 'express';

/**
 * Terminal error handler.
 *
 * Two rules govern everything here:
 *  1. **Never leak internals.** A Mongo duplicate-key error tells an attacker
 *     which field is unique and what value already exists. It is logged in
 *     full and reported as a generic conflict.
 *  2. **Always answer in the caller's language**, with a stable machine code
 *     alongside so clients can branch without string matching.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Express requires the 4-arity signature; if headers already went out the
  // only correct move is to destroy the response.
  if (res.headersSent) return next(error);

  const locale = req.locale ?? 'en';
  const apiError = normalize(error);

  const logPayload = {
    err: {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    code: apiError.code,
    status: apiError.statusCode,
    internal: apiError.internal,
    path: req.originalUrl.split('?')[0],
    method: req.method,
    userId: req.principal?.id,
  };

  if (apiError.statusCode >= 500) {
    logger.error(logPayload, 'request failed');
  } else if (apiError.statusCode === 429) {
    logger.warn({ ...logPayload, err: undefined }, 'request rate limited');
  } else {
    logger.debug(logPayload, 'request rejected');
  }

  if (apiError.retryAfter) {
    res.setHeader('Retry-After', String(apiError.retryAfter));
  }

  res.status(apiError.statusCode).json({
    ok: false,
    error: {
      code: apiError.code,
      message: translate(apiError.message, locale),
      ...(apiError.details?.length
        ? {
            details: apiError.details.map((issue) => ({
              ...issue,
              message: translateField(issue.message, locale),
            })),
          }
        : {}),
      requestId: req.id,
      ...(apiError.retryAfter ? { retryAfter: apiError.retryAfter } : {}),
      // Stack traces are a development affordance only.
      ...(!isProduction && apiError.statusCode >= 500 && error instanceof Error
        ? { stack: error.stack?.split('\n').slice(0, 8) }
        : {}),
    },
  });
}

function normalize(error: unknown): ApiError {
  if (isApiError(error)) return error;

  if (error instanceof ZodError) {
    const details: FieldIssue[] = error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
      code: issue.code,
    }));
    return ApiError.validation(details);
  }

  if (error instanceof MongooseError.ValidationError) {
    const details: FieldIssue[] = Object.entries(error.errors).map(([path, issue]) => ({
      path,
      message: issue.message,
    }));
    return ApiError.validation(details);
  }

  if (error instanceof MongooseError.CastError) {
    // A malformed ObjectId is a 404, not a 500: the resource cannot exist.
    return ApiError.notFound();
  }

  // Duck-typed rather than `instanceof MongoServerError`: the driver is a
  // transitive dependency of mongoose and importing it directly would pin a
  // version this package does not own.
  if ((error as { code?: number })?.code === 11000) {
    const duplicate = error as { keyPattern?: Record<string, unknown>; keyValue?: unknown };
    const field = Object.keys(duplicate.keyPattern ?? {})[0] ?? '';
    const message = field.includes('slug')
      ? 'errors.duplicate_slug'
      : field.includes('sku')
        ? 'errors.duplicate_sku'
        : field.includes('email')
          ? 'errors.email_taken'
          : 'errors.conflict';
    return new ApiError(409, ERROR_CODES.CONFLICT, message, { internal: duplicate.keyValue });
  }

  // Body parser rejections.
  const candidate = error as { type?: string; status?: number; statusCode?: number };
  if (candidate?.type === 'entity.too.large') return ApiError.payloadTooLarge();
  if (candidate?.type === 'entity.parse.failed') return ApiError.badRequest('errors.bad_request');
  if (candidate?.type === 'charset.unsupported') return ApiError.unsupportedMediaType();

  const status = candidate?.status ?? candidate?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return new ApiError(status, ERROR_CODES.VALIDATION_ERROR, 'errors.bad_request');
  }

  return ApiError.internal('errors.internal', error);
}

/** 404 for unmatched routes: registered after every router. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound());
}
