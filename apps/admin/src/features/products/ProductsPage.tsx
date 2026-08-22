import { Pencil, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { DataTable, type Column } from '@/components/common/DataTable';
import { Pagination } from '@/components/common/Pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { localized, useFormat } from '@/lib/format';
import { useAdminProducts } from '@/lib/queries';
import { useAuthStore } from '@/stores/auth';

import type { ProductCard } from '@sunshop/shared';

export function ProductsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('products.title'));
  const can = useAuthStore((state) => state.can);
  const format = useFormat();

  const [term, setTerm] = useState('');
  const [status, setStatus] = useState<'active' | 'draft' | 'archived'>('active');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useAdminProducts({ q: term || undefined, status, page, limit: 20 });

  const columns: Column<ProductCard>[] = [
    {
      key: 'name',
      header: t('products.name'),
      cell: (row) => (
        <div className="flex items-center gap-3">
          <div className="bg-muted size-9 shrink-0 overflow-hidden rounded">
            {row.image?.url && (
              <img src={row.image.url} alt="" className="size-full object-cover" loading="lazy" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{localized(row.name, format.locale)}</p>
            {row.brand && <p className="text-muted-foreground truncate text-xs">{row.brand}</p>}
          </div>
        </div>
      ),
    },
    {
      key: 'price',
      header: t('products.price'),
      cell: (row) => (
        <span className="numeric">{format.moneyRange(row.priceRange.min, row.priceRange.max)}</span>
      ),
    },
    {
      key: 'stock',
      header: t('products.stock'),
      hideOnMobile: true,
      cell: (row) => (
        <Badge variant={row.inStock ? 'success' : 'destructive'}>
          {row.inStock ? t('common.yes') : t('common.no')}
        </Badge>
      ),
    },
    {
      key: 'rating',
      header: '★',
      hideOnMobile: true,
      cell: (row) => (
        <span className="numeric text-muted-foreground">
          {row.rating.count > 0 ? row.rating.average.toFixed(1) : '-'}
        </span>
      ),
    },
  ];

  const editColumn: Column<ProductCard> = {
    key: 'edit',
    header: '',
    className: 'text-end',
    cell: (row) => (
      <Button variant="ghost" size="icon-sm" asChild aria-label={t('products.edit')}>
        <Link to={`/products/${row.id}/edit`}>
          <Pencil className="size-3.5" aria-hidden />
        </Link>
      </Button>
    ),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">{t('products.title')}</h1>

        {can('product:write') && (
          <Button asChild>
            <Link to="/products/new">
              <Plus aria-hidden />
              {t('products.create')}
            </Link>
          </Button>
        )}
      </div>

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
            placeholder={t('common.search')}
            className="ps-9"
            aria-label={t('common.search')}
          />
        </div>

        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as typeof status);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">{t('products.published')}</SelectItem>
            <SelectItem value="draft">{t('products.draft')}</SelectItem>
            <SelectItem value="archived">{t('products.archived')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={can('product:write') ? [...columns, editColumn] : columns}
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
