import {
  BarChart3,
  ClipboardList,
  LayoutGrid,
  Package,
  Settings,
  ShoppingCart,
  Star,
  Tag,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

import type { Permission } from '@sunshop/shared';

interface NavEntry {
  to: string;
  label: string;
  icon: typeof Package;
  /** Hidden unless the signed-in principal holds this permission. */
  permission?: Permission;
  end?: boolean;
}

/**
 * Primary navigation.
 *
 * Entries are filtered by permission so a support agent does not see a
 * "Settings" link that would only 403. The filtering is cosmetic: the server
 * rejects the request either way: but a UI that offers actions it cannot
 * perform trains people to ignore errors.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const can = useAuthStore((state) => state.can);

  const groups: { label?: string; entries: NavEntry[] }[] = [
    {
      entries: [
        {
          to: '/',
          label: t('nav.dashboard'),
          icon: BarChart3,
          permission: 'analytics:read',
          end: true,
        },
      ],
    },
    {
      label: t('nav.catalog'),
      entries: [
        { to: '/products', label: t('nav.products'), icon: Package, permission: 'product:read' },
        {
          to: '/categories',
          label: t('nav.categories'),
          icon: LayoutGrid,
          permission: 'category:read',
        },
        {
          to: '/inventory',
          label: t('nav.inventory'),
          icon: ClipboardList,
          permission: 'inventory:read',
        },
      ],
    },
    {
      entries: [
        { to: '/orders', label: t('nav.orders'), icon: ShoppingCart, permission: 'order:read:any' },
        { to: '/customers', label: t('nav.customers'), icon: Users, permission: 'user:read:any' },
        { to: '/coupons', label: t('nav.coupons'), icon: Tag, permission: 'coupon:read' },
        { to: '/reviews', label: t('nav.reviews'), icon: Star, permission: 'review:moderate' },
      ],
    },
    {
      entries: [
        { to: '/audit', label: t('nav.audit'), icon: ClipboardList, permission: 'audit:read' },
        { to: '/settings', label: t('nav.settings'), icon: Settings, permission: 'settings:read' },
      ],
    },
  ];

  return (
    <nav className="flex h-full flex-col gap-6 p-4" aria-label={t('common.appName')}>
      {groups.map((group, index) => {
        const visible = group.entries.filter((entry) => !entry.permission || can(entry.permission));
        if (visible.length === 0) return null;

        return (
          <div key={index}>
            {group.label && (
              <h2 className="text-muted-foreground mb-2 px-3 text-xs font-semibold uppercase tracking-wider">
                {group.label}
              </h2>
            )}
            <ul className="space-y-0.5">
              {visible.map((entry) => (
                <li key={entry.to}>
                  <NavLink
                    to={entry.to}
                    end={entry.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )
                    }
                  >
                    <entry.icon className="size-4 shrink-0" aria-hidden />
                    {entry.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
