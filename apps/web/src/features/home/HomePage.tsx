import { PackageCheck, RotateCcw, ShieldCheck, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { ProductCard, ProductCardSkeleton } from '@/components/product/ProductCard';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { localized } from '@/lib/format';
import { useCategoryTree, useProducts } from '@/lib/queries';
import { imageUrl } from '@/lib/utils';

/**
 * Landing page.
 *
 * Three product rails, each a separate cached query so a slow one does not hold
 * up the others. The hero is plain markup rather than an image carousel: a
 * carousel costs an LCP image plus JS, and the second slide is almost never
 * seen.
 */
export function HomePage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as 'en' | 'ar';

  const { data: categories } = useCategoryTree();
  const featured = useProducts({ featured: true, limit: 8, sort: 'best_selling' });
  const newest = useProducts({ limit: 8, sort: 'newest' });

  const trust = [
    { icon: Truck, title: t('home.freeShipping'), body: t('home.freeShippingDesc') },
    { icon: RotateCcw, title: t('home.easyReturns'), body: t('home.easyReturnsDesc') },
    { icon: ShieldCheck, title: t('home.securePayment'), body: t('home.securePaymentDesc') },
    { icon: PackageCheck, title: t('home.support'), body: t('home.supportDesc') },
  ];

  return (
    <div className="pb-8">
      <section className="from-accent/60 to-background border-b bg-gradient-to-b">
        <div className="container grid items-center gap-8 py-16 md:grid-cols-2 md:py-24">
          <div className="animate-fade-up">
            <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
              {t('home.heroTitle')}
            </h1>
            <p className="text-muted-foreground mt-4 max-w-lg text-lg">{t('home.heroSubtitle')}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/products">{t('home.shopNow')}</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/categories">{t('home.browseCategories')}</Link>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {(categories ?? []).slice(0, 4).map((category, index) => (
              <Link
                key={category.id}
                to={`/categories/${category.slug}`}
                className="bg-muted group relative aspect-[4/3] overflow-hidden rounded-xl border"
                style={{ animationDelay: `${index * 60}ms` }}
              >
                {category.imageKey && (
                  <img
                    src={imageUrl(category.imageKey, 480) ?? undefined}
                    alt=""
                    className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading={index < 2 ? 'eager' : 'lazy'}
                  />
                )}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 text-sm font-semibold text-white">
                  {localized(category.name, locale)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="container grid gap-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        {trust.map((entry) => (
          <div key={entry.title} className="flex items-start gap-3 rounded-lg border p-4">
            <span className="bg-accent text-accent-foreground flex size-10 shrink-0 items-center justify-center rounded-md">
              <entry.icon className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-semibold">{entry.title}</h2>
              <p className="text-muted-foreground text-xs">{entry.body}</p>
            </div>
          </div>
        ))}
      </section>

      <ProductRail
        title={t('home.featured')}
        href="/products?featured=true"
        products={featured.data?.data}
        loading={featured.isLoading}
      />

      <ProductRail
        title={t('home.newArrivals')}
        href="/products?sort=newest"
        products={newest.data?.data}
        loading={newest.isLoading}
      />
    </div>
  );
}

function ProductRail({
  title,
  href,
  products,
  loading,
}: {
  title: string;
  href: string;
  products: Parameters<typeof ProductCard>[0]['product'][] | undefined;
  loading: boolean;
}) {
  const { t } = useTranslation();
  useDocumentTitle(null);
  if (!loading && (products?.length ?? 0) === 0) return null;

  return (
    <section className="container py-8">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-display text-xl font-bold">{title}</h2>
        <Button asChild variant="link" size="sm">
          <Link to={href}>{t('home.viewAll')}</Link>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }, (_, index) => <ProductCardSkeleton key={index} />)
          : products!.map((product, index) => (
              <ProductCard key={product.id} product={product} priority={index < 4} />
            ))}
      </div>
    </section>
  );
}
