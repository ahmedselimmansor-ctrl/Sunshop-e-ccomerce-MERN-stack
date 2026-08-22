import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { localized, useFormat } from '@/lib/format';
import { useCart, useRemoveCartItem, useUpdateCartItem } from '@/lib/queries';
import { imageUrl } from '@/lib/utils';
import { useUiStore } from '@/stores/ui';

/**
 * Cart drawer.
 *
 * Quantity changes go straight to the server and replace the cached cart with
 * the response, so the totals shown here are always the ones checkout will
 * charge. Optimistic local maths would diverge the moment a coupon cap or a
 * free-shipping threshold is crossed.
 */
export function CartDrawer() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const format = useFormat();

  const open = useUiStore((state) => state.cartOpen);
  const setOpen = useUiStore((state) => state.setCartOpen);

  const { data: cart, isLoading } = useCart();
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();

  const items = cart?.items ?? [];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="end" className="flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {t('cart.title')}
            {items.length > 0 && (
              <span className="numeric text-muted-foreground ms-2 text-sm font-normal">
                ({t('cart.itemCount', { count: cart?.totals.itemCount ?? 0 })})
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="space-y-4">
              {[0, 1, 2].map((index) => (
                <div key={index} className="flex gap-3">
                  <Skeleton className="size-20 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title={t('cart.empty')}
              description={t('cart.emptyHint')}
              action={
                <Button asChild onClick={() => setOpen(false)}>
                  <Link to="/products">{t('cart.continueShopping')}</Link>
                </Button>
              }
            />
          ) : (
            <ul className="space-y-4">
              {items.map((item) => (
                <li key={item.id} className="flex gap-3">
                  <Link
                    to={`/products/${item.slug}`}
                    onClick={() => setOpen(false)}
                    className="bg-muted size-20 shrink-0 overflow-hidden rounded-md border"
                  >
                    {item.imageUrl && (
                      <img
                        src={imageUrl(item.imageUrl, 160) ?? item.imageUrl}
                        alt=""
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    )}
                  </Link>

                  <div className="flex flex-1 flex-col gap-1">
                    <Link
                      to={`/products/${item.slug}`}
                      onClick={() => setOpen(false)}
                      className="clamp-2 text-sm font-medium hover:underline"
                    >
                      {localized(item.name, locale)}
                    </Link>
                    {item.optionsLabel.length > 0 && (
                      <span className="text-muted-foreground text-xs">
                        {item.optionsLabel.map((option) => localized(option, locale)).join(' · ')}
                      </span>
                    )}

                    <div className="mt-auto flex items-center justify-between gap-2">
                      <div className="flex items-center rounded-md border">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={updateItem.isPending}
                          onClick={() =>
                            updateItem.mutate({ itemId: item.id, quantity: item.quantity - 1 })
                          }
                          aria-label="-"
                        >
                          <Minus className="size-3" aria-hidden />
                        </Button>
                        <span className="numeric w-8 text-center text-sm">{item.quantity}</span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={updateItem.isPending || item.quantity >= item.available}
                          onClick={() =>
                            updateItem.mutate({ itemId: item.id, quantity: item.quantity + 1 })
                          }
                          aria-label="+"
                        >
                          <Plus className="size-3" aria-hidden />
                        </Button>
                      </div>

                      <span className="numeric text-sm font-semibold">
                        {format.money(item.lineTotal)}
                      </span>

                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeItem.mutate(item.id)}
                        aria-label={t('cart.remove')}
                      >
                        <Trash2 className="text-destructive size-3.5" aria-hidden />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {(cart?.warnings.length ?? 0) > 0 && (
            <ul className="border-warning/40 bg-warning/10 mt-4 space-y-1 rounded-md border p-3 text-xs">
              {cart!.warnings.map((warning, index) => (
                <li key={index}>{warning.message}</li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && cart && (
          <SheetFooter className="flex-col gap-3">
            <div className="w-full space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('cart.subtotal')}</span>
                <span className="numeric">{format.money(cart.totals.subtotal)}</span>
              </div>
              {cart.totals.discount.amount > 0 && (
                <div className="text-success flex justify-between">
                  <span>{t('cart.discount')}</span>
                  <span className="numeric">−{format.money(cart.totals.discount)}</span>
                </div>
              )}
              <Separator className="my-2" />
              <div className="flex justify-between font-semibold">
                <span>{t('common.total')}</span>
                <span className="numeric">{format.money(cart.totals.total)}</span>
              </div>
              <p className="text-muted-foreground text-xs">{t('cart.calculatedAtCheckout')}</p>
            </div>

            <Button asChild size="lg" className="w-full" onClick={() => setOpen(false)}>
              <Link to="/checkout">{t('cart.checkout')}</Link>
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
