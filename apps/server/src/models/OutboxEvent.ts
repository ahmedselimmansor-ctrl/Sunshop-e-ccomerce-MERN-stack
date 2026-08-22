import { Schema, model } from 'mongoose';

/**
 * Transactional outbox.
 *
 * Elasticsearch indexing, email and webhooks must not run inside the request's
 * database transaction: a slow ES cluster would hold Mongo locks, and a failed
 * index write would roll back a perfectly good order. Instead the write path
 * inserts an event in the *same transaction* as the state change, and a worker
 * drains it afterwards. That gives at-least-once delivery with no lost events
 * and no dual-write inconsistency.
 *
 * Consumers must therefore be idempotent: indexing the same product twice is
 * harmless, sending the same email twice is not, so mail handlers check
 * `dedupeKey`.
 */
const outboxEventSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        'product.upserted',
        'product.deleted',
        'category.changed',
        'order.placed',
        'order.paid',
        'order.status_changed',
        'order.shipped',
        'order.refunded',
        'user.registered',
        'user.password_reset_requested',
        'user.email_verification_requested',
        'review.created',
        'cart.abandoned',
      ],
      index: true,
    },
    payload: { type: Schema.Types.Mixed, required: true },
    /** Optional natural key so a consumer can skip an already-handled event. */
    dedupeKey: { type: String, default: null, sparse: true, index: true },

    status: {
      type: String,
      enum: ['pending', 'processing', 'done', 'failed', 'dead'],
      default: 'pending',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    /** Exponential backoff: the worker only claims events due now. */
    availableAt: { type: Date, default: Date.now, index: true },

    createdAt: { type: Date, default: Date.now },
    processedAt: { type: Date, default: null },
  },
  { versionKey: false },
);

outboxEventSchema.index({ status: 1, availableAt: 1 });
// Successfully processed events are swept after a week.
outboxEventSchema.index(
  { processedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 7, partialFilterExpression: { status: 'done' } },
);

export const OutboxEvent = model('OutboxEvent', outboxEventSchema);
