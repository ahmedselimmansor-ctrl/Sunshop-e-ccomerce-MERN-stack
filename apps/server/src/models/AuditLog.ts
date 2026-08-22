import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/**
 * Append-only audit trail for every privileged action.
 *
 * Answers "who changed this price / refunded this order / granted this role,
 * from where, and why": the questions that get asked after an incident, when
 * reconstructing intent from application logs alone is hopeless.
 *
 * Retention is two years via a TTL index. In AWS the collection is additionally
 * streamed to an S3 bucket with Object Lock, so a compromised admin cannot
 * erase their own trail; nothing in the API can delete or update these
 * documents (see the immutability guards below).
 */
const auditLogSchema = new Schema(
  {
    action: { type: String, required: true, index: true },

    actor: {
      id: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
      email: { type: String, default: null },
      roles: { type: [String], default: [] },
      ip: { type: String, default: null },
      userAgent: { type: String, default: null },
    },

    target: {
      type: { type: String, default: null },
      id: { type: String, default: null, index: true },
      label: { type: String, default: null },
    },

    /** `{ field: { from, to } }` for the changed fields only. */
    changes: { type: Schema.Types.Mixed, default: null },
    reason: { type: String, maxlength: 300, default: null },
    requestId: { type: String, default: null, index: true },
    outcome: { type: String, enum: ['success', 'failure'], default: 'success' },

    // Indexed below with a TTL; declaring `index: true` here as well would
    // create a second, redundant index on the same key.
    at: { type: Date, default: Date.now },
  },
  { timestamps: false, versionKey: false },
);

auditLogSchema.index({ 'actor.id': 1, at: -1 });
auditLogSchema.index({ action: 1, at: -1 });
auditLogSchema.index({ 'target.id': 1, at: -1 });
// Two-year retention.
auditLogSchema.index({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 730 });

/** Immutability guards: an audit entry is written once and never revised. */
for (const hook of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'deleteOne',
  'deleteMany',
] as const) {
  auditLogSchema.pre(hook, function blockMutation() {
    throw new Error('Audit log entries are immutable');
  });
}

export type AuditLogAttributes = InferSchemaType<typeof auditLogSchema>;
export type AuditLogDocument = HydratedDocument<AuditLogAttributes>;

export const AuditLog = model<AuditLogAttributes>('AuditLog', auditLogSchema);
