import { PackageOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { EmptyState } from '@/components/common/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useFormat } from '@/lib/format';
import { useOrders } from '@/lib/queries';

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

export function OrdersPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('account.orders'));
  const format = useFormat();
  const { data, isLoading } = useOrders(1);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if ((data?.data.length ?? 0) === 0) {
    return (
      <EmptyState
        icon={PackageOpen}
        title={t('account.noOrders')}
        action={
          <Button asChild>
            <Link to="/products">{t('cart.continueShopping')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* The only thing naming this page was the highlighted nav item; the
          sibling account pages all title themselves at this level. */}
      <h2 className="font-display text-lg font-semibold">{t('account.orders')}</h2>

      <ul className="space-y-3">
        {data!.data.map((order) => (
          <li key={order.id}>
            <Card>
              <CardContent className="flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-40">
                  <Link
                    to={`/account/orders/${order.orderNumber}`}
                    className="numeric font-mono font-medium hover:underline"
                  >
                    {order.orderNumber}
                  </Link>
                  <p className="numeric text-muted-foreground text-xs">
                    {format.date(order.placedAt)}
                  </p>
                </div>

                <Badge variant={STATUS_VARIANT[order.status] ?? 'secondary'}>
                  {t(`orderStatus.${order.status}`)}
                </Badge>

                <span className="text-muted-foreground text-sm">
                  {t('cart.itemCount', { count: order.totals.itemCount })}
                </span>

                <span className="numeric ms-auto font-semibold">
                  {format.money(order.totals.total)}
                </span>

                <Button asChild variant="outline" size="sm">
                  <Link to={`/account/orders/${order.orderNumber}`}>{t('account.trackOrder')}</Link>
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
