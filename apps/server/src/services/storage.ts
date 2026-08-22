import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl as getCloudFrontSignedUrl } from '@aws-sdk/cloudfront-signer';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { MAX_UPLOAD_BYTES, type AllowedImageMime } from '@sunshop/shared';

import { env } from '../config/env';
import { moduleLogger } from '../observability/logger';
import { ApiError } from '../utils/ApiError';

const log = moduleLogger('storage');

/**
 * Object storage on S3, delivered through CloudFront.
 *
 * Uploads never transit the API. The client asks for a presigned POST, uploads
 * straight to S3, and submits only the resulting key. That keeps 8 MB image
 * bodies off the pods (which would otherwise dominate their memory and the
 * ALB's request budget) and means an upload cannot be used to exhaust the API's
 * connection pool.
 *
 * The presigned policy pins content-type, content-length range and key prefix,
 * so a granted upload URL cannot be repurposed to write a 5 GB file or an HTML
 * page into the bucket root.
 */
const clientConfig: S3ClientConfig = {
  region: env.AWS_REGION,
  ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  // In EKS these are absent and the SDK picks up IRSA web-identity credentials.
  ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
};

export const s3 = new S3Client(clientConfig);

const EXTENSION_BY_MIME: Record<AllowedImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export type UploadScope = 'product' | 'category' | 'avatar' | 'review' | 'brand';

/**
 * Server-derived key. The client's filename is never trusted for the path:
 * only for its extension: which removes traversal and overwrite risks
 * entirely.
 */
export function buildObjectKey(scope: UploadScope, contentType: AllowedImageMime): string {
  const extension = EXTENSION_BY_MIME[contentType] ?? 'bin';
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${scope}/${yyyy}/${mm}/${randomUUID()}.${extension}`;
}

export interface PresignResult {
  url: string;
  fields: Record<string, string>;
  key: string;
  publicUrl: string;
  expiresIn: number;
  maxBytes: number;
}

export async function presignUpload(input: {
  scope: UploadScope;
  contentType: AllowedImageMime;
  size: number;
  ownerId?: string | null;
}): Promise<PresignResult> {
  if (input.size > MAX_UPLOAD_BYTES) throw ApiError.payloadTooLarge();

  const key = buildObjectKey(input.scope, input.contentType);
  const expiresIn = env.UPLOAD_URL_TTL_SECONDS;

  try {
    const { url, fields } = await createPresignedPost(s3, {
      Bucket: env.S3_BUCKET,
      Key: key,
      Expires: expiresIn,
      Conditions: [
        ['content-length-range', 1, MAX_UPLOAD_BYTES],
        ['eq', '$Content-Type', input.contentType],
        ['starts-with', '$key', `${input.scope}/`],
      ],
      Fields: {
        'Content-Type': input.contentType,
        // Long cache: keys are content-addressed by UUID and never rewritten.
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...(input.ownerId ? { 'x-amz-meta-owner': input.ownerId } : {}),
      },
    });

    return {
      url,
      fields,
      key,
      publicUrl: publicUrlFor(key) ?? '',
      expiresIn,
      maxBytes: MAX_UPLOAD_BYTES,
    };
  } catch (error) {
    log.error({ err: (error as Error).message, key }, 'failed to presign upload');
    throw ApiError.internal('errors.upload_failed', error);
  }
}

/** Confirms the object actually landed before a key is attached to a record. */
export async function verifyUploaded(key: string): Promise<{ size: number; contentType: string }> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return {
      size: head.ContentLength ?? 0,
      contentType: head.ContentType ?? 'application/octet-stream',
    };
  } catch {
    throw ApiError.badRequest('errors.upload_failed', [
      { path: 'key', message: 'object_not_found' },
    ]);
  }
}

export async function deleteObject(key: string): Promise<void> {
  await s3
    .send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
    .catch((error: Error) => {
      log.warn({ err: error.message, key }, 'failed to delete object');
    });
}

/** Public CDN URL for catalogue media. */
export function publicUrlFor(key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^https?:\/\//i.test(key)) return key;
  return `${env.CDN_BASE_URL.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}

/**
 * Signed, expiring CloudFront URL for private objects: invoices, which must
 * not be world-readable just because someone guesses an order number.
 */
export function signedUrlFor(key: string, ttlSeconds = 300): string | null {
  if (!env.CLOUDFRONT_KEY_PAIR_ID || !env.CLOUDFRONT_PRIVATE_KEY) {
    // Without CloudFront signing configured (local dev), fall back to public.
    return publicUrlFor(key);
  }

  return getCloudFrontSignedUrl({
    url: `${env.CDN_BASE_URL.replace(/\/+$/, '')}/${key}`,
    keyPairId: env.CLOUDFRONT_KEY_PAIR_ID,
    privateKey: env.CLOUDFRONT_PRIVATE_KEY,
    dateLessThan: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  });
}

/**
 * Responsive `srcset` map. CloudFront runs a Lambda@Edge image handler that
 * honours `?w=` and `?fm=`, so one stored original serves every breakpoint and
 * modern format without a build-time render step.
 */
export function srcSetFor(
  key: string | null | undefined,
  widths: readonly number[],
): Record<string, string> {
  const base = publicUrlFor(key);
  if (!base) return {};
  return Object.fromEntries(
    widths.map((width) => [String(width), `${base}?w=${width}&fm=webp&q=82`]),
  );
}

/** Guards against a client submitting a key it was never granted. */
export function isValidKey(key: string, allowedScopes: UploadScope[]): boolean {
  if (key.includes('..') || key.startsWith('/')) return false;
  const scope = key.split('/')[0] as UploadScope;
  if (!allowedScopes.includes(scope)) return false;
  return path.posix.normalize(key) === key;
}
