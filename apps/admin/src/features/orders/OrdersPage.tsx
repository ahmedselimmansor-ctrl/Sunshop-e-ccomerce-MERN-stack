import { ORDER_STATUSES, type Order } from '@sunshop/shared';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { DataTable, type Column } from '@/components/common/DataTable';
import { Pagination } from '@/components/common/Pagination';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useFormat } from '@/lib/format';
import { useAdminOrders } from '@/lib/queries';

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
  useDocumentTitle(t('orders.title'));
  const format = useFormat();
  const navigate = useNavigate();

  const [term, setTerm] = useState('');
  const [status, setStatus] = useState<string>('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useAdminOrders({
    q: term || undefined,
    status: (status || undefined) as never,
    page,
    limit: 20,
  });

  const columns: Column<Order>[] = [
    {
      key: 'number',
      header: t('orders.number'),
      cell: (row) => <span className="numeric font-mono font-medium">{row.orderNumber}</span>,
    },
    {
      key: 'customer',
      header: t('orders.customer'),
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate">{row.shippingAddress.fullName}</p>
          <p className="text-muted-foreground truncate text-xs">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'placed',
      header: t('orders.placed'),
      hideOnMobile: true,
      cell: (row) => (
        <span className="numeric text-muted-foreground">{format.date(row.placedAt)}</span>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (row) => (
        <Badge variant={STATUS_VARIANT[row.status] ?? 'secondary'}>{row.status}</Badge>
      ),
    },
    {
      key: 'payment',
      header: t('orders.payment'),
      hideOnMobile: true,
      cell: (row) => (
        <Badge variant={row.paymentStatus === 'paid' ? 'success' : 'secondary'}>
          {row.paymentStatus}
        </Badge>
      ),
    },
    {
      key: 'total',
      header: t('common.total'),
      className: 'text-end',
      cell: (row) => (
        <span className="numeric font-semibold">{format.money(row.totals.total)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t('orders.title')}</h1>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 md:max-w-xs">
          <Search
            className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
            }}
            placeholder={`${t('orders.number')} / ${t('customers.email')}`}
            aria-label={t('common.search')}
            className="ps-9"
          />
        </div>

        <Select
          value={status || 'all'}
          onValueChange={(value) => {
            setStatus(value === 'all' ? '' : value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.all')}</SelectItem>
            {ORDER_STATUSES.map((entry) => (
              <SelectItem key={entry} value={entry}>
                {entry}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={data?.data}
        loading={isLoading}
        rowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/orders/${row.id}`)}
        empty={t('common.noResults')}
      />

      {data && (
        <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
      )}
    </div>
  );
}
