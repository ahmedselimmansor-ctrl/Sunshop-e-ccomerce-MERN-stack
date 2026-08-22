import { ROLES, canManageUser, type Role, type User } from '@sunshop/shared';
import { Search, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { DataTable, type Column } from '@/components/common/DataTable';
import { Pagination } from '@/components/common/Pagination';
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
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useFormat } from '@/lib/format';
import { useAdminUsers, useAssignRoles } from '@/lib/queries';
import { useAuthStore } from '@/stores/auth';

/**
 * Customer and staff directory.
 *
 * Role changes require a written reason: it lands in the audit log, and
 * "someone made this person an admin last March" is exactly the question that
 * gets asked six months later. The role picker also hides anything the current
 * operator outranks, mirroring the server's escalation guard.
 */
export function UsersPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('customers.title'));
  const format = useFormat();
  const currentUser = useAuthStore((state) => state.user);

  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<User | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [reason, setReason] = useState('');

  const { data, isLoading } = useAdminUsers({ q: term || undefined, page, limit: 20 });
  const assignRoles = useAssignRoles(editing?.id ?? '');

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: t('customers.name'),
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {row.firstName} {row.lastName}
          </p>
          <p className="text-muted-foreground truncate text-xs">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'roles',
      header: t('customers.roles'),
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.roles.map((role) => (
            <Badge key={role} variant={role === 'customer' ? 'secondary' : 'default'}>
              {role}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'orders',
      header: t('customers.ordersCount'),
      hideOnMobile: true,
      cell: (row) => <span className="numeric">{row.ordersCount ?? 0}</span>,
    },
    {
      key: 'spent',
      header: t('customers.totalSpent'),
      hideOnMobile: true,
      cell: (row) => (
        <span className="numeric">
          {format.money({ amount: row.totalSpent ?? 0, currency: 'USD' })}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      cell: (row) => (
        <Badge variant={row.status === 'active' ? 'success' : 'warning'}>{row.status}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-end',
      cell: (row) => {
        const manageable =
          currentUser && !currentUser.roles.includes('customer')
            ? canManageUser(currentUser.roles, row.roles) && currentUser.id !== row.id
            : false;

        return (
          <Button
            variant="ghost"
            size="sm"
            disabled={!manageable}
            onClick={() => {
              setEditing(row);
              setRoles(row.roles);
              setReason('');
            }}
          >
            <ShieldCheck className="size-4" aria-hidden />
            {t('customers.changeRoles')}
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t('customers.title')}</h1>

      <div className="relative md:max-w-xs">
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
          aria-label={t('common.search')}
          className="ps-9"
        />
      </div>

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

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('customers.changeRoles')}</DialogTitle>
            <DialogDescription>{editing?.email}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('customers.roles')}</legend>
              {ROLES.filter((role) =>
                currentUser ? canManageUser(currentUser.roles, [role]) : false,
              ).map((role) => (
                <label key={role} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={roles.includes(role)}
                    onChange={(event) =>
                      setRoles((current) =>
                        event.target.checked
                          ? [...current, role]
                          : current.filter((entry) => entry !== role),
                      )
                    }
                  />
                  {role}
                </label>
              ))}
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="reason" required>
                {t('common.reason')}
              </Label>
              <Input
                id="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Promoted to handle refunds"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={assignRoles.isPending}
              disabled={roles.length === 0 || reason.trim().length < 3}
              onClick={() =>
                assignRoles.mutate(
                  { roles, reason },
                  {
                    onSuccess: () => {
                      toast.success(t('customers.rolesChanged'));
                      setEditing(null);
                    },
                    onError: (error: Error) => toast.error(error.message),
                  },
                )
              }
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
