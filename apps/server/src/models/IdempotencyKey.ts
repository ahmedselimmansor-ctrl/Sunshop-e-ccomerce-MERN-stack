import { Schema, model } from 'mongoose';

/**
 * Idempotency records for unsafe, retry-prone requests (checkout, refunds).
 *
 * Mobile clients retry on flaky networks and ALBs retry on 5xx; without this a
 * customer gets charged twice for one tap. The unique index on
 * `(key, userScope)` is what actually enforces it: the first request inserts,
 * a concurrent duplicate collides and waits for the stored response.
 *
 * Records live 24h, long enough to cover any sane retry window.
 */
const idempotencyKeySchema = new Schema(
  {
    key: { type: String, required: true },
    /** User id, or the anonymous cart token, so keys cannot collide across users. */
    userScope: { type: String, required: true },
    endpoint: { type: String, required: true },
    /** Hash of the request body: the same key with a different body is a bug. */
    requestHash: { type: String, required: true },

    status: { type: String, enum: ['in_progress', 'completed', 'failed'], default: 'in_progress' },
    statusCode: { type: Number, default: null },
    response: { type: Schema.Types.Mixed, default: null },

    createdAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { versionKey: false },
);

idempotencyKeySchema.index({ key: 1, userScope: 1 }, { unique: true });
idempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

export const IdempotencyKey = model('IdempotencyKey', idempotencyKeySchema);
