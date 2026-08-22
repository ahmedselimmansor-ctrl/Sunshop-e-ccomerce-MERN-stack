/* eslint-disable @typescript-eslint/no-explicit-any --
 * These mappers accept either a Mongoose `HydratedDocument` or the plain object
 * returned by `.lean()`, and the two have structurally different types for the
 * same fields (ObjectId vs string, Map vs Record). Threading a union through
 * every field access buys nothing here: the shape is validated on the way in by
 * the schema and on the way out by the DTO's own type.
 */
import { randomUUID } from 'node:crypto';

import {
  money,
  type AddToCartInput,
  type Cart as CartDto,
  type CartItem,
  type Currency,
} from '@sunshop/shared';

import { env } from '../../config/env';
import { Cart, type CartDocument } from '../../models/Cart';
import { Product } from '../../models/Product';
import { publicUrlFor } from '../../services/storage';
import { ApiError } from '../../utils/ApiError';

import { computeTotals, type PriceableLine } from './pricing.service';

import type { Principal } from '../../security/principal';
import type { Types } from 'mongoose';

/**
 * Cart operations.
 *
 * Two identities: a signed-in user (`user`) or an anonymous `guestToken` stored
 * in a cookie. Logging in merges the guest cart into the account cart rather
 * than discarding it: losing a basket at the login step is one of the most
 * expensive UX bugs an e-commerce app can ship.
 */

export interface CartIdentity {
  principal: Principal;
  guestToken?: string;
}

export async function getOrCreateCart(identity: CartIdentity): Promise<CartDocument> {
  if (identity.principal.isAuthenticated) {
    const existing = await Cart.findOne({ user: identity.principal.id, convertedOrder: null });
    if (existing) return existing;

    return Cart.create({
      user: identity.principal.id,
      currency: env.DEFAULT_CURRENCY,
      items: [],
    });
  }

  if (identity.guestToken) {
    const existing = await Cart.findOne({ guestToken: identity.guestToken, convertedOrder: null });
    if (existing) return existing;
  }

  return Cart.create({
    guestToken: identity.guestToken ?? randomUUID(),
    currency: env.DEFAULT_CURRENCY,
    items: [],
  });
}

export async function findCart(identity: CartIdentity): Promise<CartDocument | null> {
  if (identity.principal.isAuthenticated) {
    return Cart.findOne({ user: identity.principal.id, convertedOrder: null });
  }
  if (!identity.guestToken) return null;
  return Cart.findOne({ guestToken: identity.guestToken, convertedOrder: null });
}

export async function addItem(identity: CartIdentity, input: AddToCartInput): Promise<CartDto> {
  const cart = await getOrCreateCart(identity);

  const product = await Product.findOne({
    _id: input.productId,
    status: 'active',
    deletedAt: null,
  }).lean();
  if (!product) throw ApiError.notFound();

  const variant = product.variants.find((entry) => String(entry._id) === input.variantId);
  if (!variant || !variant.isActive) throw ApiError.notFound();

  const available = Math.max(0, variant.stock - variant.reserved);
  const existing = cart.items.find((item) => String(item.variantId) === input.variantId);
  const desiredQuantity = (existing?.quantity ?? 0) + input.quantity;

  if (variant.stockPolicy === 'deny' && desiredQuantity > available) {
    throw ApiError.outOfStock([
      { path: 'quantity', message: 'insufficient_stock', code: String(available) },
    ]);
  }

  // A cart holds one currency; adding across currencies is a product decision
  // we resolve by resetting to the new currency only when the cart is empty.
  if (cart.items.length === 0) {
    cart.currency = variant.price.currency as Currency;
  } else if (cart.currency !== variant.price.currency) {
    throw ApiError.conflict('errors.conflict', [
      { path: 'currency', message: 'currency_mismatch' },
    ]);
  }

  if (existing) {
    existing.quantity = Math.min(99, desiredQuantity);
    existing.unitPrice = variant.price;
  } else {
    cart.items.push({
      product: product._id as Types.ObjectId,
      variantId: variant._id as Types.ObjectId,
      sku: variant.sku,
      quantity: input.quantity,
      unitPrice: variant.price,
      addedAt: new Date(),
    } as never);
  }

  cart.lastActivityAt = new Date();
  await cart.save();

  return toCartDto(cart, identity.principal);
}

export async function updateItem(
  identity: CartIdentity,
  itemId: string,
  quantity: number,
): Promise<CartDto> {
  const cart = await findCart(identity);
  if (!cart) throw ApiError.notFound();

  const item = cart.items.find((entry) => String(entry._id) === itemId);
  if (!item) throw ApiError.notFound();

  if (quantity === 0) {
    cart.items.pull({ _id: itemId });
  } else {
    const product = await Product.findById(item.product).lean();
    const variant = product?.variants.find((entry) => String(entry._id) === String(item.variantId));
    const available = variant ? Math.max(0, variant.stock - variant.reserved) : 0;

    if (variant?.stockPolicy === 'deny' && quantity > available) {
      throw ApiError.outOfStock([
        { path: 'quantity', message: 'insufficient_stock', code: String(available) },
      ]);
    }
    item.quantity = quantity;
  }

  cart.lastActivityAt = new Date();
  await cart.save();

  return toCartDto(cart, identity.principal);
}

export async function removeItem(identity: CartIdentity, itemId: string): Promise<CartDto> {
  return updateItem(identity, itemId, 0);
}

export async function clearCart(identity: CartIdentity): Promise<CartDto> {
  const cart = await getOrCreateCart(identity);
  cart.items.splice(0, cart.items.length);
  cart.couponCode = null;
  cart.lastActivityAt = new Date();
  await cart.save();
  return toCartDto(cart, identity.principal);
}

export async function applyCoupon(identity: CartIdentity, code: string): Promise<CartDto> {
  const cart = await findCart(identity);
  if (!cart) throw ApiError.notFound();
  if (cart.items.length === 0) throw ApiError.badRequest('errors.cart_empty');

  cart.couponCode = code.toUpperCase();
  await cart.save();

  const dto = await toCartDto(cart, identity.principal);

  // The coupon is stored optimistically, then verified by the pricing pass;
  // if it produced no discount it is not valid for this cart.
  if (!dto.coupon) {
    cart.couponCode = null;
    await cart.save();
    throw ApiError.conflict('errors.coupon_invalid');
  }

  return dto;
}

export async function removeCoupon(identity: CartIdentity): Promise<CartDto> {
  const cart = await findCart(identity);
  if (!cart) throw ApiError.notFound();
  cart.couponCode = null;
  await cart.save();
  return toCartDto(cart, identity.principal);
}

/**
 * Merges a guest cart into the signed-in cart at login.
 *
 * Quantities are summed and capped rather than overwritten: a shopper who added
 * two of something before logging in and one after expects three.
 */
export async function mergeGuestCart(
  principal: Principal,
  guestToken: string,
  strategy: 'merge' | 'replace' = 'merge',
): Promise<CartDto> {
  const guestCart = await Cart.findOne({ guestToken, convertedOrder: null });
  const userCart = await getOrCreateCart({ principal });

  if (!guestCart || guestCart.items.length === 0) return toCartDto(userCart, principal);

  if (strategy === 'replace' || userCart.items.length === 0) {
    userCart.items.splice(0, userCart.items.length);
    for (const item of guestCart.items) userCart.items.push(item);
    userCart.currency = guestCart.currency;
    userCart.couponCode = guestCart.couponCode;
  } else {
    for (const guestItem of guestCart.items) {
      const existing = userCart.items.find(
        (item) => String(item.variantId) === String(guestItem.variantId),
      );
      if (existing) {
        existing.quantity = Math.min(99, existing.quantity + guestItem.quantity);
      } else if (userCart.currency === guestCart.currency) {
        userCart.items.push(guestItem);
      }
    }
  }

  userCart.lastActivityAt = new Date();
  await userCart.save();
  await guestCart.deleteOne();

  return toCartDto(userCart, principal);
}

/**
 * Builds the client-facing cart.
 *
 * Prices and availability are re-read from the catalogue on every render, so a
 * cart that has been sitting open for a week shows current reality. Divergences
 * surface as non-fatal `warnings` rather than errors: the shopper should see
 * "one item sold out" and be able to check out with the rest.
 */
export async function toCartDto(cart: CartDocument, principal: Principal): Promise<CartDto> {
  const productIds = cart.items.map((item) => item.product);
  const products = await Product.find({ _id: { $in: productIds } }).lean();
  const byId = new Map(products.map((product) => [String(product._id), product]));

  const items: CartItem[] = [];
  const warnings: CartDto['warnings'] = [];
  const priceableLines: PriceableLine[] = [];
  const currency = cart.currency as Currency;

  for (const item of cart.items) {
    const product = byId.get(String(item.product));
    const variant = product?.variants.find((entry) => String(entry._id) === String(item.variantId));

    if (!product || !variant || product.status !== 'active' || product.deletedAt) {
      warnings.push({
        code: 'item_removed',
        itemId: String(item._id),
        message: 'This item is no longer available.',
      });
      continue;
    }

    const available = Math.max(0, variant.stock - variant.reserved);
    let quantity = item.quantity;

    if (variant.stockPolicy === 'deny' && quantity > available) {
      if (available === 0) {
        warnings.push({ code: 'out_of_stock', itemId: String(item._id), message: 'Sold out.' });
      } else {
        warnings.push({
          code: 'quantity_reduced',
          itemId: String(item._id),
          message: `Only ${available} left.`,
        });
        quantity = available;
      }
    }

    const priceChanged = variant.price.amount !== item.unitPrice.amount;
    if (priceChanged) {
      warnings.push({
        code: 'price_changed',
        itemId: String(item._id),
        message: 'The price of an item changed.',
      });
    }

    const unitPrice = variant.price;
    const lineTotal = money(unitPrice.amount * quantity, currency);

    const optionsLabel = buildOptionLabels(product, variant);

    items.push({
      id: String(item._id),
      productId: String(product._id),
      variantId: String(variant._id),
      sku: variant.sku,
      name: product.name,
      slug: product.slug,
      imageUrl: publicUrlFor(variant.imageKey ?? product.images?.[0]?.key ?? null),
      optionsLabel,
      unitPrice,
      compareAtPrice: variant.compareAtPrice ?? null,
      quantity,
      lineTotal,
      available,
      inStock: available > 0 || variant.stockPolicy === 'continue',
      priceChanged,
    });

    priceableLines.push({
      productId: String(product._id),
      categoryIds: (product.categories ?? []).map(String),
      unitPrice,
      quantity,
      lineTotal,
    });
  }

  const { totals, appliedCoupon } = await computeTotals({
    lines: priceableLines,
    currency,
    couponCode: cart.couponCode,
    userId: principal.id,
    email: principal.email,
  });

  return {
    id: String(cart._id),
    userId: cart.user ? String(cart.user) : null,
    currency,
    items,
    coupon: appliedCoupon
      ? { code: appliedCoupon.code, description: null, discount: appliedCoupon.discount }
      : null,
    totals,
    warnings,
    updatedAt: new Date(cart.updatedAt ?? Date.now()).toISOString(),
  };
}

function buildOptionLabels(
  product: Record<string, any>,
  variant: Record<string, any>,
): { en: string; ar: string }[] {
  const values =
    variant.optionValues instanceof Map
      ? Object.fromEntries(variant.optionValues)
      : (variant.optionValues ?? {});

  return Object.entries(values)
    .map(([code, value]) => {
      const option = (product.options ?? []).find((entry: any) => entry.code === code);
      const optionValue = option?.values?.find((entry: any) => entry.code === value);
      if (!option || !optionValue) return null;
      return {
        en: `${option.name.en}: ${optionValue.label.en}`,
        ar: `${option.name.ar}: ${optionValue.label.ar}`,
      };
    })
    .filter((entry): entry is { en: string; ar: string } => entry !== null);
}
