/* eslint-disable @typescript-eslint/no-explicit-any --
 * These mappers accept either a Mongoose `HydratedDocument` or the plain object
 * returned by `.lean()`, and the two have structurally different types for the
 * same fields (ObjectId vs string, Map vs Record). Threading a union through
 * every field access buys nothing here: the shape is validated on the way in by
 * the schema and on the way out by the DTO's own type.
 */
import { Types } from 'mongoose';
import sanitizeHtml from 'sanitize-html';

import { Order } from '../../models/Order';
import { OutboxEvent } from '../../models/OutboxEvent';
import { Product } from '../../models/Product';
import { Review, type ReviewDocument } from '../../models/Review';
import { scopeReviews } from '../../security/dataAccess';
import { audit } from '../../services/audit';
import { invalidateTags } from '../../services/cache';
import { publicUrlFor } from '../../services/storage';
import { ApiError } from '../../utils/ApiError';
import { buildPaginationMeta } from '../../utils/http';

import type { Principal } from '../../security/principal';
import type {
  CreateReviewInput,
  PaginationMeta,
  Review as ReviewDto,
  ReviewListQuery,
} from '@sunshop/shared';

/**
 * Product reviews.
 *
 * Reviews are user-generated content rendered next to a purchase decision, so
 * three things are enforced here:
 *  • **Sanitization**: every tag and attribute is stripped, not escaped.
 *    Reviews are plain text; there is no legitimate reason for markup in one.
 *  • **Verified purchase**: the badge is derived from the order history, never
 *    from anything the client sends.
 *  • **Moderation**: new reviews land in `pending`. An unmoderated review feed
 *    becomes a spam channel within days of launch.
 */

function sanitize(input: string): string {
  return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} }).trim();
}

function toDto(document: ReviewDocument | Record<string, any>): ReviewDto {
  const user = document.user && typeof document.user === 'object' ? document.user : null;

  return {
    id: String(document._id),
    productId: String(document.product),
    user: {
      id: String(user?._id ?? document.user),
      // Only a display name: never the reviewer's email.
      name: user
        ? `${user.firstName ?? ''} ${(user.lastName ?? '').charAt(0)}.`.trim()
        : 'Customer',
      avatarUrl: publicUrlFor(user?.avatarKey ?? null),
    },
    rating: document.rating,
    title: document.title ?? null,
    body: document.body,
    images: (document.imageKeys ?? []).map((key: string) => ({
      key,
      url: publicUrlFor(key) ?? '',
    })),
    status: document.status,
    isVerifiedPurchase: Boolean(document.isVerifiedPurchase),
    helpfulCount: document.helpfulCount ?? 0,
    reply: document.reply?.body
      ? {
          body: document.reply.body,
          author: document.reply.author ?? 'Sunshop',
          at: new Date(document.reply.at).toISOString(),
        }
      : null,
    createdAt: new Date(document.createdAt).toISOString(),
    updatedAt: new Date(document.updatedAt).toISOString(),
  };
}

export async function listReviews(
  principal: Principal,
  query: ReviewListQuery,
): Promise<{ items: ReviewDto[]; meta: PaginationMeta }> {
  const filter = scopeReviews(principal, {
    ...(query.productId ? { product: query.productId } : {}),
    ...(query.rating ? { rating: query.rating } : {}),
    ...(query.status && principal.can('review:moderate') ? { status: query.status } : {}),
    ...(query.withImages ? { imageKeys: { $exists: true, $ne: [] } } : {}),
  });

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    rating_desc: { rating: -1, createdAt: -1 },
    rating_asc: { rating: 1, createdAt: -1 },
    helpful: { helpfulCount: -1, createdAt: -1 },
  };

  const [documents, total] = await Promise.all([
    Review.find(filter)
      .populate('user', 'firstName lastName avatarKey')
      .sort(sortMap[query.sort] ?? { createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Review.countDocuments(filter),
  ]);

  return {
    items: documents.map(toDto),
    meta: buildPaginationMeta(query.page, query.limit, total),
  };
}

export async function createReview(
  principal: Principal,
  input: CreateReviewInput,
): Promise<ReviewDto> {
  const product = await Product.findOne({ _id: input.productId, deletedAt: null }).select('_id');
  if (!product) throw ApiError.notFound();

  const existing = await Review.findOne({ product: input.productId, user: principal.id });
  if (existing) throw ApiError.conflict('errors.review_exists');

  // Derived server-side. A client claiming `isVerifiedPurchase: true` is
  // simply ignored: the field is not in the input schema at all.
  const purchase = await Order.findOne({
    user: principal.id,
    'items.product': input.productId,
    paymentStatus: { $in: ['paid', 'partially_refunded'] },
  })
    .select('_id')
    .lean();

  const review = await Review.create({
    product: input.productId,
    user: principal.id,
    order: purchase?._id ?? null,
    rating: input.rating,
    title: input.title ? sanitize(input.title) : null,
    body: sanitize(input.body),
    imageKeys: input.imageKeys,
    isVerifiedPurchase: Boolean(purchase),
    // Verified buyers skip the queue; everyone else is moderated.
    status: purchase ? 'approved' : 'pending',
  });

  if (review.status === 'approved') await recalculateRating(input.productId);

  await OutboxEvent.create({
    type: 'review.created',
    payload: { reviewId: String(review._id), productId: input.productId },
  });

  return toDto(await review.populate('user', 'firstName lastName avatarKey'));
}

export async function updateOwnReview(
  principal: Principal,
  reviewId: string,
  input: Partial<CreateReviewInput>,
): Promise<ReviewDto> {
  const review = await Review.findOne({ _id: reviewId, user: principal.id });
  if (!review) throw ApiError.notFound();

  if (input.rating !== undefined) review.rating = input.rating;
  if (input.title !== undefined) review.title = input.title ? sanitize(input.title) : null;
  if (input.body !== undefined) review.body = sanitize(input.body);
  if (input.imageKeys !== undefined) review.imageKeys = input.imageKeys;

  // An edited review goes back through moderation: otherwise "post something
  // benign, then edit it" is a trivial bypass.
  if (!review.isVerifiedPurchase) review.status = 'pending';

  await review.save();
  await recalculateRating(String(review.product));

  return toDto(await review.populate('user', 'firstName lastName avatarKey'));
}

export async function deleteReview(principal: Principal, reviewId: string): Promise<void> {
  const filter = principal.can('review:moderate')
    ? { _id: reviewId }
    : { _id: reviewId, user: principal.id };

  const review = await Review.findOneAndDelete(filter);
  if (!review) throw ApiError.notFound();

  await recalculateRating(String(review.product));
}

export async function moderateReview(
  principal: Principal,
  reviewId: string,
  status: 'approved' | 'rejected' | 'pending',
  note?: string,
): Promise<ReviewDto> {
  const review = await Review.findById(reviewId);
  if (!review) throw ApiError.notFound();

  const previous = review.status;
  review.status = status;
  review.moderationNote = note ?? null;
  review.moderatedBy = principal.id as never;
  review.moderatedAt = new Date();
  await review.save();

  await recalculateRating(String(review.product));

  audit({
    action: 'review.moderated',
    actor: principal,
    target: { type: 'review', id: reviewId },
    changes: { status: { from: previous, to: status } },
    reason: note,
  });

  return toDto(await review.populate('user', 'firstName lastName avatarKey'));
}

export async function replyToReview(
  principal: Principal,
  reviewId: string,
  bodyText: string,
): Promise<ReviewDto> {
  const review = await Review.findById(reviewId);
  if (!review) throw ApiError.notFound();

  review.reply = {
    body: sanitize(bodyText),
    author: 'Sunshop',
    by: principal.id as never,
    at: new Date(),
  } as never;
  await review.save();

  return toDto(await review.populate('user', 'firstName lastName avatarKey'));
}

export async function markHelpful(
  principal: Principal,
  reviewId: string,
): Promise<{ helpfulCount: number }> {
  // `$addToSet` makes the vote idempotent; the counter only moves when the
  // voter was not already in the set.
  const review = await Review.findOneAndUpdate(
    { _id: reviewId, helpfulBy: { $ne: principal.id } },
    { $addToSet: { helpfulBy: principal.id }, $inc: { helpfulCount: 1 } },
    { new: true },
  );

  if (!review) {
    const current = await Review.findById(reviewId).select('helpfulCount').lean();
    if (!current) throw ApiError.notFound();
    return { helpfulCount: current.helpfulCount };
  }

  return { helpfulCount: review.helpfulCount };
}

/**
 * Recomputes a product's rating aggregate from approved reviews only.
 *
 * Denormalized onto the product because sorting a catalogue by rating cannot
 * afford a per-product aggregation, and the search index needs a scalar.
 */
export async function recalculateRating(productId: string): Promise<void> {
  const rows = await Review.aggregate<{ _id: number; count: number }>([
    { $match: { product: new Types.ObjectId(productId), status: 'approved' } },
    { $group: { _id: '$rating', count: { $sum: 1 } } },
  ]);

  const breakdown = [0, 0, 0, 0, 0];
  let total = 0;
  let weighted = 0;

  for (const row of rows) {
    const index = row._id - 1;
    if (index >= 0 && index < 5) breakdown[index] = row.count;
    total += row.count;
    weighted += row._id * row.count;
  }

  await Product.updateOne(
    { _id: productId },
    {
      ratingAverage: total > 0 ? Number((weighted / total).toFixed(2)) : 0,
      ratingCount: total,
      ratingBreakdown: breakdown,
    },
  );

  await OutboxEvent.create({ type: 'product.upserted', payload: { productId } });
  const { cacheTags } = await import('@sunshop/shared');
  await invalidateTags(cacheTags.product(productId), cacheTags.products);
}
