import { ORDER_STATUS_TRANSITIONS, type OrderStatus } from '@sunshop/shared';
import { ArrowLeft, Truck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { localized, useFormat } from '@/lib/format';
import { useAddShipment, useAdminOrder, useRefundOrder, useUpdateOrderStatus } from '@/lib/queries';
import { useAuthStore } from '@/stores/auth';

/**
 * Order workspace.
 *
 * The status dropdown offers only transitions the API will accept: the state
 * machine lives in `@sunshop/shared` and both sides read the same table, so the
 * UI cannot present an action that is guaranteed to 409.
 */
export function OrderDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const format = useFormat();
  const can = useAuthStore((state) => state.can);

  const { data: order, isLoading } = useAdminOrder(id);
  const updateStatus = useUpdateOrderStatus(id);
  const addShipment = useAddShipment(id);
  const refund = useRefundOrder(id);

  useDocumentTitle(order ? order.orderNumber : null);

  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');

  if (isLoading || !order) return <Skeleton className="h-96 w-full" />;

  const allowedTransitions = ORDER_STATUS_TRANSITIONS[order.status as OrderStatus] ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/orders" aria-label={t('orders.title')}>
            <ArrowLeft className="rtl:rotate-180" aria-hidden />
          </Link>
        </Button>
        <h1 className="numeric font-display text-2xl font-bold">{order.orderNumber}</h1>
        <Badge>{order.status}</Badge>
        <Badge variant={order.paymentStatus === 'paid' ? 'success' : 'secondary'}>
          {order.paymentStatus}
        </Badge>
        <span className="numeric ms-auto text-lg font-bold">
          {format.money(order.totals.total)}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">{t('orders.items')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {order.items.map((item) => (
                  <li key={item.variantId} className="flex items-center gap-3 py-3">
                    <div className="bg-muted size-12 shrink-0 overflow-hidden rounded">
                      {item.imageUrl && (
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {localized(item.name, format.locale)}
                      </p>
                      <code className="text-muted-foreground text-xs">{item.sku}</code>
                    </div>
                    <span className="numeric text-muted-foreground text-sm">×{item.quantity}</span>
                    <span className="numeric text-sm font-semibold">
                      {format.money(item.lineTotal)}
                    </span>
                  </li>
                ))}
              </ul>

              <Separator className="my-4" />

              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="numeric">{format.money(order.totals.subtotal)}</dd>
                </div>
                {order.totals.discount.amount > 0 && (
                  <div className="text-success flex justify-between">
                    <dt>Discount {order.couponCode ? `(${order.couponCode})` : ''}</dt>
                    <dd className="numeric">−{format.money(order.totals.discount)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Shipping</dt>
                  <dd className="numeric">{format.money(order.totals.shipping)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Tax</dt>
                  <dd className="numeric">{format.money(order.totals.tax)}</dd>
                </div>
                {order.refundedAmount && order.refundedAmount.amount > 0 && (
                  <div className="text-destructive flex justify-between">
                    <dt>Refunded</dt>
                    <dd className="numeric">−{format.money(order.refundedAmount)}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">{t('orders.timeline')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {order.timeline.map((entry, index) => (
                  <li key={index} className="flex gap-3 text-sm">
                    <span className="bg-primary mt-1.5 size-2 shrink-0 rounded-full" aria-hidden />
                    <div>
                      <p>{entry.message}</p>
                      <p className="numeric text-muted-foreground text-xs">
                        {format.date(entry.at, { dateStyle: 'medium', timeStyle: 'short' })}
                        {entry.actor?.name ? ` · ${entry.actor.name}` : ''}
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
              <CardTitle as="h2">{t('orders.shippingAddress')}</CardTitle>
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

          {can('order:write') && allowedTransitions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle as="h2">{t('orders.updateStatus')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Select
                  onValueChange={(value) =>
                    updateStatus.mutate(
                      { status: value },
                      {
                        onSuccess: () => toast.success(t('common.save')),
                        onError: (error: Error) => toast.error(error.message),
                      },
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('orders.updateStatus')} />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedTransitions.map((next) => (
                      <SelectItem key={next} value={next}>
                        {next}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          )}

          {can('order:write') && ['paid', 'processing'].includes(order.status) && (
            <Card>
              <CardHeader>
                <CardTitle as="h2" className="flex items-center gap-2">
                  <Truck className="size-4" aria-hidden />
                  {t('orders.addShipment')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="carrier">{t('orders.carrier')}</Label>
                  <Input
                    id="carrier"
                    value={carrier}
                    onChange={(event) => setCarrier(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tracking">{t('orders.trackingNumber')}</Label>
                  <Input
                    id="tracking"
                    value={tracking}
                    dir="ltr"
                    onChange={(event) => setTracking(event.target.value)}
                  />
                </div>
                <Button
                  className="w-full"
                  loading={addShipment.isPending}
                  disabled={carrier.length < 2 || tracking.length < 3}
                  onClick={() =>
                    addShipment.mutate(
                      { carrier, trackingNumber: tracking, notifyCustomer: true },
                      {
                        onSuccess: () => {
                          toast.success(t('orders.addShipment'));
                          setCarrier('');
                          setTracking('');
                        },
                        onError: (error: Error) => toast.error(error.message),
                      },
                    )
                  }
                >
                  {t('orders.addShipment')}
                </Button>
              </CardContent>
            </Card>
          )}

          {can('order:refund') && order.paymentStatus === 'paid' && (
            <Card>
              <CardHeader>
                <CardTitle as="h2">{t('orders.refund')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  variant="destructive"
                  className="w-full"
                  loading={refund.isPending}
                  onClick={() => {
                    if (
                      !window.confirm(`${t('orders.refund')} ${format.money(order.totals.total)}?`)
                    )
                      return;
                    refund.mutate(
                      { reason: 'requested_by_customer', restock: true },
                      {
                        onSuccess: () => toast.success(t('orders.refund')),
                        onError: (error: Error) => toast.error(error.message),
                      },
                    );
                  }}
                >
                  {t('orders.refund')} {format.money(order.totals.total)}
                </Button>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
