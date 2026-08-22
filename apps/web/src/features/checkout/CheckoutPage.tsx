import { zodResolver } from '@hookform/resolvers/zod';
import { checkoutSchema, type CheckoutInput } from '@sunshop/shared';
import { CheckCircle2, CreditCard, Truck, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ApiClientError } from '@/lib/api';
import { localized, useFormat } from '@/lib/format';
import { useCart, useCheckout, useShippingMethods } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';

/**
 * Checkout.
 *
 * The form is validated with the *same* zod schema the API uses, so a payload
 * that passes here is by construction one the server accepts: no drift between
 * client and server rules, and no second definition to keep in sync.
 *
 * `expectedTotal` is submitted alongside the order: if the server recomputes a
 * different total (a price changed, a coupon expired while the user was typing)
 * it rejects rather than silently charging a different amount.
 */
export function CheckoutPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('checkout.title'));
  const locale = useUiStore((state) => state.locale);
  const navigate = useNavigate();
  const format = useFormat();

  const user = useAuthStore((state) => state.user);
  const { data: cart, isLoading } = useCart();
  const checkout = useCheckout();

  const [country, setCountry] = useState('EG');
  const [placed, setPlaced] = useState<{ orderNumber: string; email: string } | null>(null);

  const { data: shippingMethods } = useShippingMethods(
    country,
    cart?.totals.subtotal.amount ?? 0,
    cart?.currency ?? 'USD',
  );

  const form = useForm<CheckoutInput>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      billingSameAsShipping: true,
      paymentMethod: 'cash_on_delivery',
      shippingMethodId: 'standard',
      shippingAddress: { country: 'EG', fullName: '', phone: '', line1: '', city: '' },
      email: user?.email,
    },
  });

  if (placed) {
    return (
      <div className="container max-w-lg py-20">
        <EmptyState
          titleAs="h1"
          icon={CheckCircle2}
          title={t('checkout.successTitle')}
          description={t('checkout.successBody', placed)}
          action={
            <div className="flex gap-2">
              <Button asChild>
                <Link to={`/account/orders/${placed.orderNumber}`}>{t('checkout.viewOrder')}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/products">{t('cart.continueShopping')}</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  if (!isLoading && (cart?.items.length ?? 0) === 0) {
    return (
      <div className="container py-20">
        <EmptyState
          titleAs="h1"
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

  const paymentMethods = [
    { value: 'cash_on_delivery' as const, label: t('checkout.cashOnDelivery'), icon: Wallet },
    { value: 'card' as const, label: t('checkout.payWithCard'), icon: CreditCard },
  ];

  async function onSubmit(values: CheckoutInput) {
    if (!cart) return;

    try {
      const order = await checkout.mutateAsync({ ...values, expectedTotal: cart.totals.total });
      setPlaced({ orderNumber: order.orderNumber, email: order.email });
      window.scrollTo({ top: 0 });
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.code === 'CONFLICT' || error.code === 'OUT_OF_STOCK') {
          toast.error(error.message);
          navigate('/cart');
          return;
        }
        // Map server-side field errors back onto the form.
        for (const [path, message] of Object.entries(error.fieldErrors)) {
          form.setError(path as keyof CheckoutInput, { message });
        }
        toast.error(error.message);
      } else {
        toast.error(t('errors.generic'));
      }
    }
  }

  return (
    <div className="container py-8">
      <h1 className="font-display mb-8 text-2xl font-bold">{t('checkout.title')}</h1>

      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('checkout.shippingAddress')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('checkout.fullName')}
                error={form.formState.errors.shippingAddress?.fullName?.message}
                required
              >
                <Input {...form.register('shippingAddress.fullName')} autoComplete="name" />
              </Field>

              <Field
                label={t('checkout.phone')}
                error={form.formState.errors.shippingAddress?.phone?.message}
                hint="+20 1XX XXX XXXX"
                required
              >
                <Input
                  {...form.register('shippingAddress.phone')}
                  autoComplete="tel"
                  inputMode="tel"
                  dir="ltr"
                  placeholder="+201001234567"
                />
              </Field>

              {!user && (
                <Field
                  label={t('checkout.email')}
                  error={form.formState.errors.email?.message}
                  className="sm:col-span-2"
                  required
                >
                  <Input {...form.register('email')} type="email" autoComplete="email" dir="ltr" />
                </Field>
              )}

              <Field
                label={t('checkout.line1')}
                error={form.formState.errors.shippingAddress?.line1?.message}
                className="sm:col-span-2"
                required
              >
                <Input {...form.register('shippingAddress.line1')} autoComplete="address-line1" />
              </Field>

              <Field label={t('checkout.line2')} className="sm:col-span-2">
                <Input {...form.register('shippingAddress.line2')} autoComplete="address-line2" />
              </Field>

              <Field
                label={t('checkout.city')}
                error={form.formState.errors.shippingAddress?.city?.message}
                required
              >
                <Input {...form.register('shippingAddress.city')} autoComplete="address-level2" />
              </Field>

              <Field label={t('checkout.state')}>
                <Input {...form.register('shippingAddress.state')} autoComplete="address-level1" />
              </Field>

              <Field
                label={t('checkout.country')}
                error={form.formState.errors.shippingAddress?.country?.message}
                required
              >
                <Input
                  {...form.register('shippingAddress.country', {
                    onChange: (event) => setCountry(event.target.value.toUpperCase()),
                  })}
                  maxLength={2}
                  dir="ltr"
                  className="uppercase"
                  autoComplete="country"
                />
              </Field>

              <Field label={t('checkout.notes')} className="sm:col-span-2">
                <Textarea {...form.register('customerNote')} rows={2} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('checkout.deliveryMethod')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(shippingMethods ?? []).map((method) => {
                const selected = form.watch('shippingMethodId') === method.id;
                return (
                  <label
                    key={method.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors',
                      selected ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                    )}
                  >
                    <input
                      type="radio"
                      value={method.id}
                      {...form.register('shippingMethodId')}
                      className="sr-only"
                    />
                    <Truck className="text-muted-foreground size-5" aria-hidden />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">
                        {localized(method.name, locale)}
                      </span>
                      {method.estimatedDays && (
                        <span className="text-muted-foreground block text-xs">
                          {t('checkout.estimatedDays', { count: method.estimatedDays })}
                        </span>
                      )}
                    </span>
                    <span className="numeric text-sm font-semibold">
                      {method.price.amount === 0 ? '-' : format.money(method.price)}
                    </span>
                  </label>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('checkout.payment')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {paymentMethods.map((method) => {
                const selected = form.watch('paymentMethod') === method.value;
                return (
                  <label
                    key={method.value}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors',
                      selected ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                    )}
                  >
                    <input
                      type="radio"
                      value={method.value}
                      {...form.register('paymentMethod')}
                      className="sr-only"
                    />
                    <method.icon className="text-muted-foreground size-5" aria-hidden />
                    <span className="flex-1 text-sm font-medium">{method.label}</span>
                  </label>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <Card>
            <CardHeader>
              <CardTitle>{t('checkout.orderSummary')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-3">
                {(cart?.items ?? []).map((item) => (
                  <li key={item.id} className="flex gap-3 text-sm">
                    <span className="numeric bg-muted flex size-6 shrink-0 items-center justify-center rounded text-xs">
                      {item.quantity}
                    </span>
                    <span className="clamp-2 flex-1">{localized(item.name, locale)}</span>
                    <span className="numeric">{format.money(item.lineTotal)}</span>
                  </li>
                ))}
              </ul>

              <Separator />

              {cart && (
                <dl className="space-y-1.5 text-sm">
                  <Row label={t('cart.subtotal')} value={format.money(cart.totals.subtotal)} />
                  {cart.totals.discount.amount > 0 && (
                    <Row
                      label={t('cart.discount')}
                      value={`−${format.money(cart.totals.discount)}`}
                      tone="success"
                    />
                  )}
                  <Row label={t('cart.shipping')} value={format.money(cart.totals.shipping)} />
                  <Row label={t('cart.tax')} value={format.money(cart.totals.tax)} />
                  <Separator className="my-2" />
                  <Row label={t('common.total')} value={format.money(cart.totals.total)} strong />
                </dl>
              )}

              <Button type="submit" size="lg" className="w-full" loading={checkout.isPending}>
                {t('checkout.placeOrder')}
              </Button>
            </CardContent>
          </Card>
        </aside>
      </form>
    </div>
  );
}

function Field({
  label,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label required={required}>{label}</Label>
      {children}
      {hint && !error && <p className="text-muted-foreground text-xs">{hint}</p>}
      {error && (
        <p role="alert" className="text-destructive text-xs font-medium">
          {error}
        </p>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'success';
}) {
  return (
    <div
      className={cn(
        'flex justify-between',
        strong && 'text-base font-semibold',
        tone === 'success' && 'text-success',
      )}
    >
      <dt>{label}</dt>
      <dd className="numeric">{value}</dd>
    </div>
  );
}
