import { z } from 'zod';

import { REVIEW_STATUSES } from '../constants';

import { objectIdSchema, paginationQuerySchema } from './common';

export const createReviewSchema = z.object({
  productId: objectIdSchema,
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(3).max(120).optional(),
  body: z.string().trim().min(10).max(4000),
  /** Uploaded via the media endpoint first; only keys are submitted here. */
  imageKeys: z.array(z.string().max(300)).max(5).default([]),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const updateReviewSchema = createReviewSchema.omit({ productId: true }).partial();

export const moderateReviewSchema = z.object({
  status: z.enum(REVIEW_STATUSES),
  moderationNote: z.string().trim().max(300).optional(),
});

export const reviewSchema = z.object({
  id: objectIdSchema,
  productId: objectIdSchema,
  user: z.object({
    id: objectIdSchema,
    /** Display name only: never the email. */
    name: z.string(),
    avatarUrl: z.string().url().nullable(),
  }),
  rating: z.number().int(),
  title: z.string().nullable(),
  body: z.string(),
  images: z.array(z.object({ key: z.string(), url: z.string().url() })).default([]),
  status: z.enum(REVIEW_STATUSES),
  /** Set when the reviewer actually bought the product. */
  isVerifiedPurchase: z.boolean(),
  helpfulCount: z.number().int().default(0),
  reply: z
    .object({
      body: z.string(),
      author: z.string(),
      at: z.string(),
    })
    .nullable()
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Review = z.infer<typeof reviewSchema>;

export const reviewListQuerySchema = paginationQuerySchema.extend({
  productId: objectIdSchema.optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  status: z.enum(REVIEW_STATUSES).optional(),
  withImages: z.coerce.boolean().optional(),
  sort: z.enum(['newest', 'oldest', 'rating_desc', 'rating_asc', 'helpful']).default('newest'),
});
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;

export const replyToReviewSchema = z.object({
  body: z.string().trim().min(2).max(1500),
});
