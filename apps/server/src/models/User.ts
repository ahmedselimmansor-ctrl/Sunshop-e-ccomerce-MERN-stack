import {
  DEFAULT_LOCALE,
  DEFAULT_ROLE,
  LOCALES,
  ROLES,
  THEMES,
  USER_STATUSES,
  type Locale,
  type Role,
  type Theme,
  type UserStatus,
} from '@sunshop/shared';
import { Schema, model, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';

import {
  blindIndex,
  canEncrypt,
  decryptField,
  encryptField,
  isEncrypted,
} from '../security/crypto';

/**
 * Users.
 *
 * PII handling: `phone` is encrypted at rest with AES-256-GCM and shadowed by
 * `phoneIndex`, an HMAC that makes "find by phone" possible without decrypting
 * the collection. Email stays in plaintext because it is the login identifier
 * and must support prefix search in the admin: it is instead protected by the
 * storage-level KMS encryption and by strict field projection.
 */

const addressSchema = new Schema(
  {
    label: { type: String, trim: true, maxlength: 40 },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, trim: true, maxlength: 100 },
    postalCode: { type: String, trim: true, maxlength: 20 },
    country: { type: String, required: true, uppercase: true, minlength: 2, maxlength: 2 },
    notes: { type: String, trim: true, maxlength: 500 },
    isDefaultShipping: { type: Boolean, default: false },
    isDefaultBilling: { type: Boolean, default: false },
  },
  { _id: true, timestamps: false },
);

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      index: true,
    },
    passwordHash: { type: String, required: true, select: false },
    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, required: true, trim: true, maxlength: 60 },

    /** AES-GCM ciphertext. Never query this directly: use `phoneIndex`. */
    phone: { type: String, default: null, select: false },
    phoneIndex: { type: String, default: null, index: true, select: false },

    avatarKey: { type: String, default: null, maxlength: 300 },

    roles: {
      type: [String],
      enum: ROLES,
      default: [DEFAULT_ROLE],
      validate: {
        validator: (value: string[]) => value.length > 0,
        message: 'user must hold at least one role',
      },
    },
    status: { type: String, enum: USER_STATUSES, default: 'pending_verification', index: true },

    emailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, default: null, select: false },
    emailVerificationExpiresAt: { type: Date, default: null, select: false },

    passwordResetTokenHash: { type: String, default: null, select: false },
    passwordResetExpiresAt: { type: Date, default: null, select: false },
    passwordChangedAt: { type: Date, default: null },

    totpEnabled: { type: Boolean, default: false },
    totpSecret: { type: String, default: null, select: false },
    /** Hashed single-use recovery codes. */
    totpRecoveryCodes: { type: [String], default: [], select: false },

    /**
     * Bumped on password change, role change, or forced logout. Access tokens
     * carry the version they were minted with; a mismatch rejects the token
     * without a database read on the hot path being able to miss a revocation.
     */
    tokenVersion: { type: Number, default: 0 },

    locale: { type: String, enum: LOCALES, default: DEFAULT_LOCALE },
    theme: { type: String, enum: THEMES, default: 'system' },
    marketingOptIn: { type: Boolean, default: false },

    addresses: { type: [addressSchema], default: [] },

    /** Denormalized lifetime stats, refreshed when an order reaches `paid`. */
    ordersCount: { type: Number, default: 0, min: 0 },
    totalSpent: { type: Number, default: 0, min: 0 },

    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null, select: false },
    suspendedReason: { type: String, default: null },
    suspendedUntil: { type: Date, default: null },

    /** Set when the account is anonymized under a deletion request. */
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

userSchema.index({ createdAt: -1 });
userSchema.index({ roles: 1, status: 1 });
userSchema.index({ totalSpent: -1 });
// Case-insensitive prefix search for the admin user list.
userSchema.index({ firstName: 'text', lastName: 'text', email: 'text' });

userSchema.virtual('fullName').get(function fullName(this: {
  firstName: string;
  lastName: string;
}) {
  return `${this.firstName} ${this.lastName}`.trim();
});

/** Transparent phone encryption on the way in. */
userSchema.pre('save', function encryptPhone(next) {
  if (this.isModified('phone') && this.phone && canEncrypt() && !isEncrypted(this.phone)) {
    const plain = this.phone;
    this.phone = encryptField(plain);
    this.phoneIndex = blindIndex(plain);
  }
  if (this.isModified('phone') && !this.phone) {
    this.phoneIndex = null;
  }
  next();
});

userSchema.methods.decryptedPhone = function decryptedPhone(this: { phone?: string | null }) {
  if (!this.phone) return null;
  if (!isEncrypted(this.phone)) return this.phone;
  try {
    return decryptField(this.phone);
  } catch {
    return null;
  }
};

userSchema.methods.isSuspended = function isSuspended(this: {
  status: UserStatus;
  suspendedUntil?: Date | null;
}) {
  if (this.status === 'suspended') {
    return !this.suspendedUntil || this.suspendedUntil.getTime() > Date.now();
  }
  return false;
};

export type UserAttributes = InferSchemaType<typeof userSchema> & {
  locale: Locale;
  theme: Theme;
  roles: Role[];
  status: UserStatus;
};

export interface UserMethods {
  decryptedPhone(): string | null;
  isSuspended(): boolean;
}

export type UserDocument = HydratedDocument<UserAttributes, UserMethods>;
export type UserModel = Model<UserAttributes, Record<string, never>, UserMethods>;

export const User = model<UserAttributes, UserModel>('User', userSchema);
