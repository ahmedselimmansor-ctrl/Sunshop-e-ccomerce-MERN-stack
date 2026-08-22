import { z } from 'zod';

import {
  localizedStringSchema,
  objectIdSchema,
  partialLocalizedStringSchema,
  slugSchema,
} from './common';

export const categoryBaseSchema = z.object({
  name: localizedStringSchema,
  slug: slugSchema,
  description: partialLocalizedStringSchema.optional(),
  parent: objectIdSchema.nullable().optional(),
  imageKey: z.string().max(300).nullable().optional(),
  iconName: z.string().max(60).nullable().optional(),
  position: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
  showInNav: z.boolean().default(true),
  seo: z
    .object({
      title: partialLocalizedStringSchema.optional(),
      description: partialLocalizedStringSchema.optional(),
    })
    .optional(),
});

export const createCategorySchema = categoryBaseSchema;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = categoryBaseSchema.partial();
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const categorySchema = categoryBaseSchema.extend({
  id: objectIdSchema,
  /**
   * Materialized ancestor path (`/root/parent/self`). Lets one indexed prefix
   * query fetch an entire subtree without a recursive `$graphLookup`.
   */
  path: z.string(),
  depth: z.number().int(),
  imageUrl: z.string().url().nullable().optional(),
  productCount: z.number().int().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Category = z.infer<typeof categorySchema>;

export type CategoryNode = Category & { children: CategoryNode[] };

export const categoryNodeSchema: z.ZodType<CategoryNode> = categorySchema.extend({
  children: z.lazy(() => z.array(categoryNodeSchema)),
}) as z.ZodType<CategoryNode>;

export const reorderCategoriesSchema = z.object({
  items: z
    .array(
      z.object({
        id: objectIdSchema,
        parent: objectIdSchema.nullable(),
        position: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(500),
});
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;
