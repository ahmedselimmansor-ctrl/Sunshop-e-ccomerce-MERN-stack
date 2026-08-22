import { Facebook, Instagram, Mail, Youtube } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { localized } from '@/lib/format';
import { useCategoryTree, useStoreConfig } from '@/lib/queries';
import { useUiStore } from '@/stores/ui';

export function Footer() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const { data: config } = useStoreConfig();
  const { data: categories } = useCategoryTree();

  const socials = [
    { key: 'facebook', icon: Facebook, href: config?.socialLinks?.facebook },
    { key: 'instagram', icon: Instagram, href: config?.socialLinks?.instagram },
    { key: 'youtube', icon: Youtube, href: config?.socialLinks?.youtube },
  ].filter((entry) => Boolean(entry.href));

  return (
    <footer className="bg-muted/30 mt-16 border-t">
      <div className="container grid gap-8 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="font-display flex items-center gap-2 text-lg font-bold">
            <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
              S
            </span>
            {localized(config?.storeName, locale) || 'Sunshop'}
          </div>
          <p className="text-muted-foreground mt-3 max-w-xs text-sm">{t('home.heroSubtitle')}</p>
          {socials.length > 0 && (
            <div className="mt-4 flex gap-2">
              {socials.map(({ key, icon: Icon, href }) => (
                <a
                  key={key}
                  href={href!}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={key}
                  className="hover:bg-accent flex size-9 items-center justify-center rounded-md border transition-colors"
                >
                  <Icon className="size-4" aria-hidden />
                </a>
              ))}
            </div>
          )}
        </div>

        <nav aria-labelledby="footer-categories">
          <h2 id="footer-categories" className="mb-3 text-sm font-semibold">
            {t('nav.categories')}
          </h2>
          <ul className="text-muted-foreground space-y-2 text-sm">
            {(categories ?? []).slice(0, 5).map((category) => (
              <li key={category.id}>
                <Link to={`/categories/${category.slug}`} className="hover:text-foreground">
                  {localized(category.name, locale)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="footer-account">
          <h2 id="footer-account" className="mb-3 text-sm font-semibold">
            {t('common.account')}
          </h2>
          <ul className="text-muted-foreground space-y-2 text-sm">
            <li>
              <Link to="/account" className="hover:text-foreground">
                {t('nav.profile')}
              </Link>
            </li>
            <li>
              <Link to="/account/orders" className="hover:text-foreground">
                {t('nav.orders')}
              </Link>
            </li>
            <li>
              <Link to="/cart" className="hover:text-foreground">
                {t('common.cart')}
              </Link>
            </li>
          </ul>
        </nav>

        <div>
          <h2 className="mb-3 text-sm font-semibold">{t('nav.support')}</h2>
          {config?.supportEmail && (
            <a
              href={`mailto:${config.supportEmail}`}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm"
            >
              <Mail className="size-4" aria-hidden />
              {config.supportEmail}
            </a>
          )}
        </div>
      </div>

      <div className="border-t py-6">
        <p className="text-muted-foreground container text-center text-xs">
          © <span className="numeric">{new Date().getFullYear()}</span>{' '}
          {localized(config?.storeName, locale) || 'Sunshop'}
        </p>
      </div>
    </footer>
  );
}
