import { ShoppingBag, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ApiClientError } from '@/lib/api';
import { localized, useFormat } from '@/lib/format';
import {
  useApplyCoupon,
  useCart,
  useRemoveCartItem,
  useRemoveCoupon,
  useUpdateCartItem,
} from '@/lib/queries';
import { imageUrl } from '@/lib/utils';
import { useUiStore } from '@/stores/ui';

export function CartPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('cart.title'));
  const locale = useUiStore((state) => state.locale);
  const format = useFormat();

  const { data: cart, isLoading } = useCart();
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();
  const applyCoupon = useApplyCoupon();
  const removeCoupon = useRemoveCoupon();
  const [code, setCode] = useState('');

  if (!isLoading && (cart?.items.length ?? 0) === 0) {
    return (
      <div className="container py-20">
        <EmptyState
          titleAs="h1"
          icon={ShoppingBag}
          title={t('cart.empty')}
          description={t('cart.emptyHint')}
          action={
            <Button asChild>
              <Link to="/products">{t('cart.continueShopping')}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="container py-8">
      <h1 className="font-display mb-6 text-2xl font-bold">{t('cart.title')}</h1>

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-4">
          {(cart?.items ?? []).map((item) => (
            <Card key={item.id}>
              <CardContent className="flex gap-4 p-4">
                <Link
                  to={`/products/${item.slug}`}
                  className="bg-muted size-24 shrink-0 overflow-hidden rounded-md border"
                >
                  {item.imageUrl && (
                    <img
                      src={imageUrl(item.imageUrl, 240) ?? item.imageUrl}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  )}
                </Link>

                <div className="flex flex-1 flex-col">
                  <Link to={`/products/${item.slug}`} className="font-medium hover:underline">
                    {localized(item.name, locale)}
                  </Link>
                  {item.optionsLabel.length > 0 && (
                    <span className="text-muted-foreground text-sm">
                      {item.optionsLabel.map((option) => localized(option, locale)).join(' · ')}
                    </span>
                  )}
                  <span className="numeric text-muted-foreground mt-1 text-sm">
                    {format.money(item.unitPrice)}
                  </span>

                  <div className="mt-auto flex flex-wrap items-center gap-3 pt-3">
                    <label className="sr-only" htmlFor={`qty-${item.id}`}>
                      {t('common.quantity')}
                    </label>
                    <Input
                      id={`qty-${item.id}`}
                      type="number"
                      min={1}
                      max={Math.max(1, item.available)}
                      value={item.quantity}
                      onChange={(event) =>
                        updateItem.mutate({ itemId: item.id, quantity: Number(event.target.value) })
                      }
                      className="numeric h-9 w-20"
                    />
                    <span className="numeric font-semibold">{format.money(item.lineTotal)}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive ms-auto"
                      onClick={() => removeItem.mutate(item.id)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                      {t('cart.remove')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <Card>
            <CardContent className="space-y-4 p-6">
              {cart?.coupon ? (
                <div className="border-success/40 bg-success/10 flex items-center justify-between rounded-md border p-3 text-sm">
                  <span>{t('cart.couponApplied', { code: cart.coupon.code })}</span>
                  <Button variant="ghost" size="sm" onClick={() => removeCoupon.mutate()}>
                    {t('cart.removeCoupon')}
                  </Button>
                </div>
              ) : (
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    applyCoupon.mutate(code, {
                      onError: (error) =>
                        toast.error(
                          error instanceof ApiClientError ? error.message : t('errors.generic'),
                        ),
                      onSuccess: () => setCode(''),
                    });
                  }}
                >
                  <Input
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase())}
                    placeholder={t('cart.couponCode')}
                    dir="ltr"
                    aria-label={t('cart.couponCode')}
                  />
                  <Button type="submit" variant="outline" loading={applyCoupon.isPending}>
                    {t('cart.applyCoupon')}
                  </Button>
                </form>
              )}

              <Separator />

              {cart && (
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t('cart.subtotal')}</dt>
                    <dd className="numeric">{format.money(cart.totals.subtotal)}</dd>
                  </div>
                  {cart.totals.discount.amount > 0 && (
                    <div className="text-success flex justify-between">
                      <dt>{t('cart.discount')}</dt>
                      <dd className="numeric">−{format.money(cart.totals.discount)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">{t('cart.tax')}</dt>
                    <dd className="numeric">{format.money(cart.totals.tax)}</dd>
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between text-base font-semibold">
                    <dt>{t('common.total')}</dt>
                    <dd className="numeric">{format.money(cart.totals.total)}</dd>
                  </div>
                </dl>
              )}

              <Button asChild size="lg" className="w-full">
                <Link to="/checkout">{t('cart.checkout')}</Link>
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
