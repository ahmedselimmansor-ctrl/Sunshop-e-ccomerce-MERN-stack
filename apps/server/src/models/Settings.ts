import { CURRENCIES, LOCALES } from '@sunshop/shared';
import { Schema, model } from 'mongoose';

const localized = new Schema(
  {
    en: { type: String, default: '' },
    ar: { type: String, default: '' },
  },
  { _id: false },
);

const moneySchema = new Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, enum: CURRENCIES },
  },
  { _id: false },
);

/**
 * Store-wide settings as a singleton document (`_id: 'store'`).
 *
 * Kept in the database rather than in environment variables because merchants
 * change these from the dashboard; a tax-rate change must not require a
 * redeploy. The document is cached in Redis with a short TTL and invalidated on
 * write, so the read cost on the hot path is nil.
 */
const settingsSchema = new Schema(
  {
    _id: { type: String, default: 'store' },

    storeName: { type: localized, default: { en: 'Sunshop', ar: 'صن شوب' } },
    supportEmail: { type: String, default: 'support@sunshop.example' },
    supportPhone: { type: String, default: null },

    defaultCurrency: { type: String, enum: CURRENCIES, default: 'USD' },
    defaultLocale: { type: String, enum: LOCALES, default: 'en' },
    shipsToCountries: { type: [String], default: [] },

    taxRatePercent: { type: Number, default: 0, min: 0, max: 100 },
    taxIncludedInPrices: { type: Boolean, default: false },
    freeShippingThreshold: { type: moneySchema, default: null },

    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: { type: localized, default: undefined },

    socialLinks: {
      facebook: { type: String, default: null },
      instagram: { type: String, default: null },
      x: { type: String, default: null },
      tiktok: { type: String, default: null },
      youtube: { type: String, default: null },
    },

    announcement: {
      enabled: { type: Boolean, default: false },
      text: { type: localized, default: undefined },
      href: { type: String, default: null },
    },

    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false, _id: false },
);

export const Settings = model('Settings', settingsSchema);

export async function getSettings() {
  const existing = await Settings.findById('store').lean();
  if (existing) return existing;
  return (await Settings.create({ _id: 'store' })).toObject();
}
