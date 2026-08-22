import { Schema, model } from 'mongoose';

/**
 * Atomic sequence generator for human-facing references.
 *
 * `findOneAndUpdate` with `$inc` and `upsert` is a single atomic document
 * operation, so two pods placing orders in the same millisecond cannot mint the
 * same order number. Sequences are scoped per year so numbers restart cleanly
 * and never grow unwieldy.
 */
const counterSchema = new Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);

export const Counter = model('Counter', counterSchema);

export async function nextSequence(name: string): Promise<number> {
  const result = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  return result?.seq ?? 1;
}

/** `SN-2026-000123` */
export async function nextOrderNumber(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const seq = await nextSequence(`order:${year}`);
  return `SN-${year}-${String(seq).padStart(6, '0')}`;
}
