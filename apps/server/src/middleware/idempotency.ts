import { ERROR_CODES, IDEMPOTENCY_KEY_HEADER } from '@sunshop/shared';

import { IdempotencyKey } from '../models/IdempotencyKey';
import { moduleLogger } from '../observability/logger';
import { sha256 } from '../security/crypto';
import { ApiError } from '../utils/ApiError';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

const log = moduleLogger('idempotency');

/**
 * Idempotent replay for unsafe operations.
 *
 * A phone on a flaky connection retries POST /orders; without this the customer
 * is charged twice. With it, the second request finds the stored response and
 * replays it byte for byte.
 *
 * Semantics follow the IETF idempotency-key draft:
 *  • same key + same body → the original response, with `Idempotent-Replay: true`
 *  • same key + different body → 422 (the key is being reused for a new
 *    operation, which is a client bug and must be loud)
 *  • key still in flight → 409, telling the client to retry shortly
 */
export function idempotent(options: { required?: boolean } = {}): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.get(IDEMPOTENCY_KEY_HEADER);

    if (!key) {
      if (options.required) {
        return next(
          ApiError.badRequest('errors.bad_request', [
            { path: IDEMPOTENCY_KEY_HEADER, message: 'header_required' },
          ]),
        );
      }
      return next();
    }

    if (key.length < 8 || key.length > 200) {
      return next(
        ApiError.badRequest('errors.bad_request', [
          { path: IDEMPOTENCY_KEY_HEADER, message: 'invalid_length' },
        ]),
      );
    }

    handle(req, res, next, key).catch(next);
  };
}

async function handle(req: Request, res: Response, next: NextFunction, key: string): Promise<void> {
  const userScope = req.principal?.id ?? req.cartToken ?? `ip:${req.ip}`;
  const endpoint = `${req.method} ${req.baseUrl}${req.path}`;
  const requestHash = sha256(JSON.stringify(req.body ?? {}));

  try {
    // Insert-first: the unique index is what makes this race-free across pods.
    await IdempotencyKey.create({
      key,
      userScope,
      endpoint,
      requestHash,
      status: 'in_progress',
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;

    const existing = await IdempotencyKey.findOne({ key, userScope });
    if (!existing) throw error;

    if (existing.requestHash !== requestHash) {
      throw new ApiError(422, ERROR_CODES.VALIDATION_ERROR, 'errors.idempotency_conflict');
    }

    if (existing.status === 'in_progress') {
      // The original is still running; a retry now would double-execute.
      throw new ApiError(409, ERROR_CODES.CONFLICT, 'errors.idempotency_conflict', {
        retryAfter: 2,
      });
    }

    if (existing.status === 'failed') {
      /**
       * A failed attempt is *not* a result worth replaying: the whole point of
       * a client retry after a 500 is to actually try again. Drop the record
       * and fall through so this request executes normally; the operation
       * itself is what must be idempotent, and it is (order numbers come from
       * an atomic counter, inventory from guarded updates).
       */
      await IdempotencyKey.deleteOne({ _id: existing._id });
      log.info({ key, endpoint }, 'discarding failed idempotency record; retrying');
      next();
      return;
    }

    log.info({ key, endpoint }, 'replaying idempotent response');
    res.setHeader('Idempotent-Replay', 'true');
    res.status(existing.statusCode ?? 200).json(existing.response);
    return;
  }

  // Capture the outgoing body so a later retry can replay it verbatim.
  const originalJson = res.json.bind(res);
  res.json = (payload: unknown) => {
    const statusCode = res.statusCode;
    // Only successful outcomes are stored: a failed attempt should be
    // retryable, not permanently cached as a failure.
    const status = statusCode >= 200 && statusCode < 300 ? 'completed' : 'failed';

    void IdempotencyKey.updateOne(
      { key, userScope },
      {
        status,
        statusCode,
        response: status === 'completed' ? payload : null,
        completedAt: new Date(),
      },
    ).catch((error: Error) =>
      log.error({ err: error.message, key }, 'failed to persist idempotency record'),
    );

    return originalJson(payload);
  };

  next();
}
