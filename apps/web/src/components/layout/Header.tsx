import { Menu, Search, ShoppingBag, User, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { LocaleSwitcher } from '@/components/common/LocaleSwitcher';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { localized } from '@/lib/format';
import { useCart, useCategoryTree, useStoreConfig, useSuggestions } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';

/**
 * Site header.
 *
 * Holds the three things every page needs: search, cart, account. The search
 * box is debounced through `useSuggestions` rather than firing per keystroke:
 * suggest is the most-called endpoint in the whole API and the cheapest place
 * to waste capacity.
 */
export function Header() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const locale = useUiStore((state) => state.locale);

  const { data: config } = useStoreConfig();
  const { data: categories } = useCategoryTree();
  const { data: cart } = useCart();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const setCartOpen = useUiStore((state) => state.setCartOpen);

  const [term, setTerm] = useState(searchParams.get('q') ?? '');
  const [debounced, setDebounced] = useState(term);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const searchRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const { data: suggestions } = useSuggestions(debounced);

  // Close the suggestion popover on an outside click.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!searchRef.current?.contains(event.target as Node)) setSuggestOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const itemCount = cart?.totals.itemCount ?? 0;
  const topCategories = (categories ?? []).filter((category) => category.showInNav).slice(0, 6);

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    setSuggestOpen(false);
    if (term.trim()) navigate(`/search?q=${encodeURIComponent(term.trim())}`);
  }

  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      {config?.announcement?.enabled && config.announcement.text && (
        <div className="bg-primary text-primary-foreground">
          <div className="container flex h-9 items-center justify-center text-xs font-medium">
            {config.announcement.href ? (
              <Link to={config.announcement.href}>
                {localized(config.announcement.text, locale)}
              </Link>
            ) : (
              <span>{localized(config.announcement.text, locale)}</span>
            )}
          </div>
        </div>
      )}

      <div className="container flex h-16 items-center gap-3">
        {/* Mobile navigation */}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('common.menu')}>
              <Menu aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="start" className="flex flex-col p-0">
            <SheetHeader>
              <SheetTitle>{t('nav.categories')}</SheetTitle>
            </SheetHeader>
            <nav className="flex-1 overflow-y-auto p-4">
              <ul className="space-y-1">
                {(categories ?? []).map((category) => (
                  <li key={category.id}>
                    <Link
                      to={`/categories/${category.slug}`}
                      className="hover:bg-accent block rounded-md px-3 py-2 text-sm font-medium"
                    >
                      {localized(category.name, locale)}
                    </Link>
                    {category.children.length > 0 && (
                      <ul className="ms-4 border-s ps-3">
                        {category.children.map((child) => (
                          <li key={child.id}>
                            <Link
                              to={`/categories/${child.slug}`}
                              className="text-muted-foreground hover:bg-accent hover:text-foreground block rounded-md px-3 py-1.5 text-sm"
                            >
                              {localized(child.name, locale)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          </SheetContent>
        </Sheet>

        <Link to="/" className="font-display flex items-center gap-2 text-lg font-bold">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
            S
          </span>
          <span className="hidden sm:inline">
            {localized(config?.storeName, locale) || 'Sunshop'}
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {topCategories.map((category) => (
            <Link
              key={category.id}
              to={`/categories/${category.slug}`}
              className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-md px-3 py-2 text-sm font-medium transition-colors"
            >
              {localized(category.name, locale)}
            </Link>
          ))}
        </nav>

        <form
          ref={searchRef}
          onSubmit={submitSearch}
          className="relative ms-auto flex-1 md:max-w-md"
        >
          <label htmlFor="site-search" className="sr-only">
            {t('common.search')}
          </label>
          <Search
            className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            id="site-search"
            type="search"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setSuggestOpen(true);
            }}
            onFocus={() => setSuggestOpen(true)}
            placeholder={t('common.searchPlaceholder')}
            className="ps-9"
            autoComplete="off"
            role="combobox"
            aria-expanded={suggestOpen && Boolean(suggestions?.length)}
            aria-controls="search-suggestions"
          />
          {term && (
            <button
              type="button"
              onClick={() => setTerm('')}
              className="text-muted-foreground hover:bg-accent absolute end-2 top-1/2 -translate-y-1/2 rounded-full p-1"
              aria-label={t('common.clear')}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}

          {suggestOpen && (suggestions?.length ?? 0) > 0 && (
            <ul
              id="search-suggestions"
              role="listbox"
              className="bg-popover absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-md border shadow-lg"
            >
              {suggestions!.map((suggestion) => (
                <li
                  key={`${suggestion.type}-${suggestion.text}`}
                  role="option"
                  aria-selected={false}
                >
                  <button
                    type="button"
                    className="hover:bg-accent flex w-full items-center gap-3 px-3 py-2 text-start text-sm"
                    onClick={() => {
                      setSuggestOpen(false);
                      navigate(
                        suggestion.slug
                          ? `/products/${suggestion.slug}`
                          : `/search?q=${encodeURIComponent(suggestion.text)}`,
                      );
                    }}
                  >
                    {suggestion.imageUrl && (
                      <img
                        src={suggestion.imageUrl}
                        alt=""
                        className="size-8 rounded object-cover"
                        loading="lazy"
                      />
                    )}
                    <span className="clamp-2">{suggestion.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>

        <div className="flex items-center gap-0.5">
          <LocaleSwitcher />
          <ThemeToggle />

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('common.account')}>
                  <Avatar className="size-7">
                    {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                    <AvatarFallback>
                      {(user.firstName[0] ?? '') + (user.lastName[0] ?? '')}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/account">{t('nav.profile')}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/account/orders">{t('nav.orders')}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/account/addresses">{t('nav.addresses')}</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void logout()}>
                  {t('nav.signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button variant="ghost" size="icon" asChild aria-label={t('nav.signIn')}>
              <Link to="/login">
                <User aria-hidden />
              </Link>
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="relative"
            onClick={() => setCartOpen(true)}
            aria-label={`${t('common.cart')} (${itemCount})`}
          >
            <ShoppingBag aria-hidden />
            {itemCount > 0 && (
              <span
                className={cn(
                  'numeric size-4.5 absolute -end-0.5 -top-0.5 flex min-w-[1.125rem] items-center justify-center',
                  'bg-primary text-primary-foreground rounded-full px-1 text-[10px] font-bold',
                )}
              >
                {itemCount > 99 ? '99+' : itemCount}
              </span>
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}
