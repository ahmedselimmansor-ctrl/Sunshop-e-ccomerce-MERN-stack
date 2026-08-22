import { ExternalLink, Menu } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router-dom';

import { LocaleSwitcher } from '@/components/common/LocaleSwitcher';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { Sidebar } from '@/components/layout/Sidebar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useAuthStore } from '@/stores/auth';

const STOREFRONT_URL = import.meta.env.VITE_STOREFRONT_URL ?? 'http://localhost:5173';

/**
 * Puts the reader at the start of the new page on navigation.
 *
 * Changing routes in a SPA leaves both scroll position and focus where they
 * were, so moving from a long order list to an order detail kept the reader
 * halfway down a page they had not seen, with focus still on the sidebar link.
 * Skipped on first render so it does not fight the browser on load.
 */
function ResetOnNavigate() {
  const { pathname } = useLocation();
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);

  return null;
}

export function AdminLayout() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  return (
    <div className="flex min-h-dvh">
      <ResetOnNavigate />

      {/* The sidebar is a dozen links deep and precedes the content in DOM
          order, so keyboard users would otherwise tab it on every navigation. */}
      <a
        href="#main"
        className="sr-only-focusable bg-primary text-primary-foreground absolute z-50 m-2 rounded-md px-4 py-2"
      >
        {t('common.skipToContent')}
      </a>

      <aside className="bg-card hidden w-64 shrink-0 border-e lg:block">
        <div className="font-display flex h-14 items-center gap-2 border-b px-4 font-bold">
          <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
            S
          </span>
          {t('common.appName')}
        </div>
        <Sidebar />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/95 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-4 backdrop-blur">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Menu">
                <Menu aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="start" className="w-72 p-0">
              <SheetTitle className="border-b p-4">{t('common.appName')}</SheetTitle>
              <Sidebar />
            </SheetContent>
          </Sheet>

          <div className="ms-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <a href={STOREFRONT_URL} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="size-4" aria-hidden />
                <span className="hidden sm:inline">Storefront</span>
              </a>
            </Button>

            <LocaleSwitcher />
            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={user?.email ?? ''}>
                  <Avatar className="size-7">
                    <AvatarFallback>
                      {(user?.firstName[0] ?? '') + (user?.lastName[0] ?? '')}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="normal-case">
                  <span className="block font-medium">{user?.email}</span>
                  <span className="text-muted-foreground block text-xs">
                    {user?.roles.join(', ')}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void logout()}>
                  {t('common.signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* tabIndex -1 so the skip link actually moves focus here, not just
            the scroll position. */}
        <main id="main" tabIndex={-1} className="bg-muted/20 flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
