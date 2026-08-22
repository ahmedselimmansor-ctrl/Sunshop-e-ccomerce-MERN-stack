import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTable, type Column } from '@/components/common/DataTable';
import { Pagination } from '@/components/common/Pagination';
import { Badge } from '@/components/ui/badge';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useFormat } from '@/lib/format';
import { useAuditLog } from '@/lib/queries';

import type { AuditEntry } from '@sunshop/shared';

/**
 * Audit trail viewer.
 *
 * Read-only by construction: the API exposes no mutation for these documents
 * and the model blocks updates and deletes, so this page cannot be turned into
 * a way to rewrite history.
 */
export function AuditPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('audit.title'));
  const format = useFormat();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useAuditLog({ page, limit: 25 });

  const columns: Column<AuditEntry>[] = [
    {
      key: 'action',
      header: t('audit.action'),
      cell: (row) => <code className="text-xs font-medium">{row.action}</code>,
    },
    {
      key: 'actor',
      header: t('audit.actor'),
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{row.actor.email ?? 'system'}</p>
          <p className="text-muted-foreground truncate text-xs">{row.actor.roles.join(', ')}</p>
        </div>
      ),
    },
    {
      key: 'target',
      header: t('audit.target'),
      hideOnMobile: true,
      cell: (row) =>
        row.target ? (
          <span className="text-muted-foreground text-xs">
            {row.target.type}
            {row.target.label ? ` · ${row.target.label}` : ''}
          </span>
        ) : (
          '-'
        ),
    },
    {
      key: 'changes',
      header: t('audit.changes'),
      hideOnMobile: true,
      cell: (row) =>
        row.changes ? (
          <div className="flex flex-wrap gap-1">
            {Object.entries(row.changes)
              .slice(0, 3)
              .map(([field, change]) => {
                const value = change as { from?: unknown; to?: unknown };
                return (
                  <Badge key={field} variant="outline" className="font-mono text-[10px]">
                    {field}: {String(value?.from ?? '-')} → {String(value?.to ?? '-')}
                  </Badge>
                );
              })}
          </div>
        ) : (
          '-'
        ),
    },
    {
      key: 'ip',
      header: t('audit.ip'),
      hideOnMobile: true,
      cell: (row) => (
        <span className="numeric text-muted-foreground text-xs">{row.actor.ip ?? '-'}</span>
      ),
    },
    {
      key: 'when',
      header: t('audit.when'),
      className: 'text-end',
      cell: (row) => (
        <span className="numeric text-muted-foreground whitespace-nowrap text-xs">
          {format.date(row.at, { dateStyle: 'short', timeStyle: 'short' })}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t('audit.title')}</h1>

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
