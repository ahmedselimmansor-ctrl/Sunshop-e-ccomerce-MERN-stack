import { ArrowLeft, Package, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { EmptyState } from '@/components/common/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ApiClientError } from '@/lib/api';
import { localized, useFormat } from '@/lib/format';
import { useCancelOrder, useOrder } from '@/lib/queries';
import { imageUrl } from '@/lib/utils';
import { useUiStore } from '@/stores/ui';

const STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive'
> = {
  pending_payment: 'warning',
  paid: 'default',
  processing: 'default',
  shipped: 'secondary',
  delivered: 'success',
  cancelled: 'destructive',
  refunded: 'destructive',
};

/**
 * Customer-facing order detail.
 *
 * Cancellation is offered only while the API would actually accept it, so the
 * button never appears just to return a 409. The rule lives in the order state
 * machine; this mirrors the two states it permits.
 */
export function OrderDetailPage() {
  const { orderNumber = '' } = useParams();
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useUiStore((state) => state.locale);

  const { data: order, isLoading, isError } = useOrder(orderNumber);
  const cancelOrder = useCancelOrder();

  useDocumentTitle(orderNumber || null);

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  if (isError || !order) {
    return (
      <EmptyState
        icon={Package}
        title={t('errors.notFound')}
        description={t('errors.notFoundHint')}
        action={
          <Button asChild>
            <Link to="/account/orders">{t('account.orders')}</Link>
          </Button>
        }
      />
    );
  }

  const cancellable = ['pending_payment', 'paid'].includes(order.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/account/orders" aria-label={t('account.orders')}>
            <ArrowLeft className="rtl:rotate-180" aria-hidden />
          </Link>
        </Button>
        <h2 className="numeric font-display text-xl font-bold">{order.orderNumber}</h2>
        <Badge variant={STATUS_VARIANT[order.status] ?? 'secondary'}>
          {t(`orderStatus.${order.status}`)}
        </Badge>
        <span className="numeric text-muted-foreground ms-auto text-sm">
          {format.date(order.placedAt, { dateStyle: 'long' })}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('cart.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {order.items.map((item) => (
                  <li key={item.variantId} className="flex items-center gap-3 py-3">
                    <div className="bg-muted size-14 shrink-0 overflow-hidden rounded">
                      {item.imageUrl && (
                        <img
                          src={imageUrl(item.imageUrl, 160) ?? item.imageUrl}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{localized(item.name, locale)}</p>
                      <p className="numeric text-muted-foreground text-xs">
                        {item.sku} x{item.quantity}
                      </p>
                    </div>
                    <span className="numeric text-sm font-semibold">
                      {format.money(item.lineTotal)}
                    </span>
                  </li>
                ))}
              </ul>

              <Separator className="my-4" />

              <dl className="space-y-1.5 text-sm">
                <Row label={t('cart.subtotal')} value={format.money(order.totals.subtotal)} />
                {order.totals.discount.amount > 0 && (
                  <Row
                    label={t('cart.discount')}
                    value={`-${format.money(order.totals.discount)}`}
                    tone="success"
                  />
                )}
                <Row label={t('cart.shipping')} value={format.money(order.totals.shipping)} />
                <Row label={t('cart.tax')} value={format.money(order.totals.tax)} />
                <Separator className="my-2" />
                <Row label={t('common.total')} value={format.money(order.totals.total)} strong />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('account.trackOrder')}</CardTitle>
            </CardHeader>
            <CardContent>
              {order.shipments.length > 0 && (
                <div className="border-primary/40 bg-primary/5 mb-4 rounded-md border p-3 text-sm">
                  {order.shipments.map((shipment) => (
                    <div key={shipment.trackingNumber} className="flex items-center gap-2">
                      <Truck className="size-4" aria-hidden />
                      <span>{shipment.carrier}</span>
                      <code className="numeric text-xs">{shipment.trackingNumber}</code>
                      {shipment.trackingUrl && (
                        <a
                          href={shipment.trackingUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-primary ms-auto text-xs hover:underline"
                        >
                          {t('account.trackOrder')}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <ol className="space-y-3">
                {order.timeline.map((entry, index) => (
                  <li key={index} className="flex gap-3 text-sm">
                    <span className="bg-primary mt-1.5 size-2 shrink-0 rounded-full" aria-hidden />
                    <div>
                      <p>{entry.message}</p>
                      <p className="numeric text-muted-foreground text-xs">
                        {format.date(entry.at, { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('checkout.shippingAddress')}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground space-y-0.5 text-sm">
              <p className="text-foreground font-medium">{order.shippingAddress.fullName}</p>
              <p className="numeric" dir="ltr">
                {order.shippingAddress.phone}
              </p>
              <p>{order.shippingAddress.line1}</p>
              {order.shippingAddress.line2 && <p>{order.shippingAddress.line2}</p>}
              <p>
                {order.shippingAddress.city}, {order.shippingAddress.country}
              </p>
            </CardContent>
          </Card>

          {cancellable && (
            <Button
              variant="outline"
              className="text-destructive w-full"
              loading={cancelOrder.isPending}
              onClick={() => {
                if (!window.confirm(t('account.cancelOrder'))) return;
                cancelOrder.mutate(
                  { id: order.id, reason: 'Cancelled by customer' },
                  {
                    onSuccess: () => toast.success(t('account.cancelOrder')),
                    onError: (error) =>
                      toast.error(
                        error instanceof ApiClientError ? error.message : t('errors.generic'),
                      ),
                  },
                );
              }}
            >
              {t('account.cancelOrder')}
            </Button>
          )}
        </aside>
      </div>
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
      className={[
        'flex justify-between',
        strong ? 'text-base font-semibold' : '',
        tone === 'success' ? 'text-success' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <dt>{label}</dt>
      <dd className="numeric">{value}</dd>
    </div>
  );
}
