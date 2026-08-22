import { z } from 'zod';

import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from '../constants';

/**
 * Uploads never pass through the API. The client asks for a presigned S3 POST,
 * uploads directly to S3/CloudFront, then submits the returned object key.
 * That keeps large bodies off the pods and out of the ALB's request budget.
 */
export const presignUploadSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1)
    .max(200)
    /** No path separators or traversal: the key is server-derived anyway. */
    .regex(/^[^/\\]+$/, { message: 'invalid_filename' }),
  contentType: z.enum(ALLOWED_IMAGE_MIME),
  size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  scope: z.enum(['product', 'category', 'avatar', 'review', 'brand']),
});
export type PresignUploadInput = z.infer<typeof presignUploadSchema>;

export const presignedUploadSchema = z.object({
  url: z.string().url(),
  /** Form fields that must accompany the multipart POST, in order. */
  fields: z.record(z.string(), z.string()),
  key: z.string(),
  publicUrl: z.string().url(),
  expiresIn: z.number().int(),
  maxBytes: z.number().int(),
});
export type PresignedUpload = z.infer<typeof presignedUploadSchema>;

export const confirmUploadSchema = z.object({
  key: z.string().min(1).max(300),
});

export const mediaObjectSchema = z.object({
  key: z.string(),
  url: z.string().url(),
  contentType: z.string(),
  size: z.number().int(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  blurhash: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type MediaObject = z.infer<typeof mediaObjectSchema>;

export const deleteMediaSchema = z.object({
  key: z.string().min(1).max(300),
});
