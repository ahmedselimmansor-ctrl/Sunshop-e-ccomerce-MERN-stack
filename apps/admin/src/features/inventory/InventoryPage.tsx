import { PackageCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { localized, useFormat } from '@/lib/format';
import { useAdjustStock, useLowStock, type LowStockRow } from '@/lib/queries';
import { useAuthStore } from '@/stores/auth';

const REASONS = ['restock', 'correction', 'damage', 'return', 'manual'] as const;

/**
 * Low-stock worklist.
 *
 * Adjustments are entered as a signed delta rather than an absolute count. Two
 * people counting the same shelf at the same time both submit "+12" and both
 * are applied; both submitting "set to 40" silently loses one of them.
 */
export function InventoryPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.inventory'));
  const format = useFormat();
  const can = useAuthStore((state) => state.can);

  const [threshold, setThreshold] = useState<number | undefined>(undefined);
  const [editing, setEditing] = useState<LowStockRow | null>(null);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState<(typeof REASONS)[number]>('restock');

  const { data: rows, isLoading } = useLowStock(threshold);
  const adjust = useAdjustStock(editing?.productId ?? '');

  const columns: Column<LowStockRow>[] = [
    {
      key: 'name',
      header: t('products.name'),
      cell: (row) => <span className="font-medium">{localized(row.name, format.locale)}</span>,
    },
    {
      key: 'sku',
      header: t('products.sku'),
      cell: (row) => <code className="numeric text-xs">{row.sku}</code>,
    },
    {
      key: 'stock',
      header: t('products.stock'),
      cell: (row) => (
        <Badge variant={row.stock === 0 ? 'destructive' : row.stock <= 2 ? 'warning' : 'secondary'}>
          <span className="numeric">{row.stock}</span>
        </Badge>
      ),
    },
    {
      key: 'threshold',
      header: t('dashboard.threshold'),
      hideOnMobile: true,
      cell: (row) => <span className="numeric text-muted-foreground">{row.threshold}</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'text-end',
      cell: (row) =>
        can('inventory:write') ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditing(row);
              setDelta('');
              setReason('restock');
            }}
          >
            {t('products.adjustStock')}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">{t('nav.inventory')}</h1>

        <Select
          value={threshold === undefined ? 'default' : String(threshold)}
          onValueChange={(value) => setThreshold(value === 'default' ? undefined : Number(value))}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{t('dashboard.threshold')}</SelectItem>
            <SelectItem value="0">0</SelectItem>
            <SelectItem value="5">5</SelectItem>
            <SelectItem value="10">10</SelectItem>
            <SelectItem value="25">25</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!isLoading && (rows?.length ?? 0) === 0 ? (
        <EmptyState
          icon={PackageCheck}
          title={t('common.noResults')}
          description={t('dashboard.lowStock')}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={isLoading}
          rowKey={(row) => row.variantId}
          empty={t('common.noResults')}
        />
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('products.adjustStock')}</DialogTitle>
            <DialogDescription>
              {editing ? `${localized(editing.name, format.locale)} (${editing.sku})` : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="delta" required>
                {t('products.delta')}
              </Label>
              <Input
                id="delta"
                type="number"
                className="numeric"
                placeholder="+12"
                value={delta}
                onChange={(event) => setDelta(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                <span className="numeric">{editing?.stock ?? 0}</span>
                {' -> '}
                <span className="numeric font-medium">
                  {(editing?.stock ?? 0) + (Number(delta) || 0)}
                </span>
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reason" required>
                {t('common.reason')}
              </Label>
              <Select value={reason} onValueChange={(value) => setReason(value as typeof reason)}>
                <SelectTrigger id="reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={adjust.isPending}
              disabled={!delta || Number.isNaN(Number(delta)) || Number(delta) === 0}
              onClick={() => {
                if (!editing) return;
                adjust.mutate(
                  { variantId: editing.variantId, delta: Number(delta), reason },
                  {
                    onSuccess: () => {
                      toast.success(t('products.adjustStock'));
                      setEditing(null);
                    },
                    onError: (error: Error) => toast.error(error.message),
                  },
                );
              }}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
