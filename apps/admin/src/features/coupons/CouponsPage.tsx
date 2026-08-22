import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { DataTable, type Column } from '@/components/common/DataTable';
import { Pagination } from '@/components/common/Pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useFormat } from '@/lib/format';
import { useCoupons, useDeleteCoupon } from '@/lib/queries';
import { useAuthStore } from '@/stores/auth';

import type { Coupon } from '@sunshop/shared';

export function CouponsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('coupons.title'));
  const format = useFormat();
  const can = useAuthStore((state) => state.can);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useCoupons({ page, limit: 20 });
  const remove = useDeleteCoupon();

  const columns: Column<Coupon>[] = [
    {
      key: 'code',
      header: t('coupons.code'),
      cell: (row) => <code className="font-mono font-medium">{row.code}</code>,
    },
    {
      key: 'type',
      header: t('coupons.type'),
      cell: (row) => <Badge variant="secondary">{t(`coupons.${row.type}`)}</Badge>,
    },
    {
      key: 'value',
      header: t('coupons.value'),
      cell: (row) => (
        <span className="numeric">
          {row.type === 'percentage'
            ? `${row.percentage}%`
            : row.type === 'fixed' && row.amount
              ? format.money(row.amount)
              : '-'}
        </span>
      ),
    },
    {
      key: 'used',
      header: t('coupons.used'),
      hideOnMobile: true,
      cell: (row) => (
        <span className="numeric">
          {row.usageCount}
          {row.usageLimit ? ` / ${row.usageLimit}` : ''}
        </span>
      ),
    },
    {
      key: 'expires',
      header: t('coupons.expires'),
      hideOnMobile: true,
      cell: (row) => (
        <span className="numeric text-muted-foreground">
          {row.endsAt ? format.date(row.endsAt as unknown as string) : '-'}
        </span>
      ),
    },
    {
      key: 'active',
      header: t('common.status'),
      cell: (row) => (
        <Badge variant={row.isActive ? 'success' : 'secondary'}>
          {row.isActive ? t('coupons.active') : t('common.no')}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-end',
      cell: (row) =>
        can('coupon:write') ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.delete')}
            onClick={() => {
              if (!window.confirm(`${t('common.delete')} ${row.code}?`)) return;
              remove.mutate(row.id, {
                onSuccess: () => toast.success(t('common.delete')),
                onError: (error: Error) => toast.error(error.message),
              });
            }}
          >
            <Trash2 className="text-destructive size-4" aria-hidden />
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t('coupons.title')}</h1>

      <DataTable
        columns={columns}
        rows={data?.data}
        loading={isLoading}
        rowKey={(row) => row.id}
        empty={t('common.noResults')}
      />

      {data && (
        <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
      )}
    </div>
  );
}
