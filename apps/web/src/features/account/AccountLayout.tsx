import { Heart, MapPin, Package, Shield, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

export function AccountLayout() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);

  const links = [
    { to: '/account', end: true, label: t('account.profile'), icon: User },
    { to: '/account/orders', end: false, label: t('account.orders'), icon: Package },
    { to: '/account/addresses', end: false, label: t('account.addresses'), icon: MapPin },
    { to: '/account/wishlist', end: false, label: t('nav.wishlist'), icon: Heart },
    { to: '/account/security', end: false, label: t('account.security'), icon: Shield },
  ];

  return (
    <div className="container py-8">
      <h1 className="font-display mb-1 text-2xl font-bold">{t('account.title')}</h1>
      {user && (
        <p className="text-muted-foreground mb-8 text-sm">
          {t('account.greeting', { name: user.firstName })}
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[14rem_1fr]">
        <nav aria-label={t('account.title')}>
          <ul className="space-y-1">
            {links.map((link) => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/60',
                    )
                  }
                >
                  <link.icon className="size-4" aria-hidden />
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* min-w-0 is load-bearing: a grid item defaults to min-width:auto, so
            it refuses to shrink below its content. Any un-wrappable string in a
            sub-page — a session's user-agent, a long order number — then pushed
            this column past the viewport and scrolled the whole page sideways
            on mobile, however carefully the child truncated its own text. */}
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
