import { PRODUCT_SORTS, type ProductSort } from '@sunshop/shared';
import { SlidersHorizontal } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';

import { EmptyState } from '@/components/common/EmptyState';
import { Pagination } from '@/components/common/Pagination';
import { ProductCard, ProductCardSkeleton } from '@/components/product/ProductCard';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { localized } from '@/lib/format';
import { useCategoryTree, useProducts } from '@/lib/queries';
import { useUiStore } from '@/stores/ui';

const SORT_LABEL: Record<ProductSort, string> = {
  relevance: 'catalog.sortRelevance',
  newest: 'catalog.sortNewest',
  price_asc: 'catalog.sortPriceAsc',
  price_desc: 'catalog.sortPriceDesc',
  rating_desc: 'catalog.sortRating',
  best_selling: 'catalog.sortBestSelling',
};

/**
 * Catalogue and search results.
 *
 * Filters live in the URL, not in component state. That makes every filtered
 * view shareable, bookmarkable and back-button-correct: and it means the
 * react-query key changes with the URL, so caching works without extra wiring.
 */
export function CatalogPage({ mode = 'catalog' }: { mode?: 'catalog' | 'search' | 'category' }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const [searchParams, setSearchParams] = useSearchParams();
  const { slug } = useParams<{ slug: string }>();

  const { data: categories } = useCategoryTree();

  const query = useMemo(
    () => ({
      q: searchParams.get('q') ?? undefined,
      category: mode === 'category' ? slug : (searchParams.get('category') ?? undefined),
      brand: searchParams.get('brand')?.split(',').filter(Boolean),
      minPrice: searchParams.get('minPrice') ? Number(searchParams.get('minPrice')) : undefined,
      maxPrice: searchParams.get('maxPrice') ? Number(searchParams.get('maxPrice')) : undefined,
      rating: searchParams.get('rating') ? Number(searchParams.get('rating')) : undefined,
      inStock: searchParams.get('inStock') === 'true' ? true : undefined,
      featured: searchParams.get('featured') === 'true' ? true : undefined,
      sort: (searchParams.get('sort') as ProductSort) ?? 'relevance',
      page: Number(searchParams.get('page') ?? 1),
      limit: 24,
    }),
    [searchParams, slug, mode],
  );

  const { data, isLoading, isError, refetch } = useProducts(query);

  function update(key: string, value: string | undefined) {
    const next = new URLSearchParams(searchParams);
    if (value === undefined || value === '') next.delete(key);
    else next.set(key, value);
    // Any filter change resets to the first page: staying on page 7 of a
    // now-3-page result set shows an empty grid.
    if (key !== 'page') next.delete('page');
    setSearchParams(next, { replace: true });
  }

  const activeCategory = categories
    ?.flatMap((category) => [category, ...category.children])
    .find((category) => category.slug === (mode === 'category' ? slug : query.category));

  const title =
    mode === 'search' && query.q
      ? t('catalog.searchResultsFor', { query: query.q })
      : activeCategory
        ? localized(activeCategory.name, locale)
        : t('catalog.title');

  useDocumentTitle(title);

  const facets = data?.facets;

  const filters = (
    <div className="space-y-6">
      {(facets?.brands.length ?? 0) > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{t('catalog.brand')}</legend>
          <div className="space-y-2">
            {facets!.brands.slice(0, 10).map((bucket) => {
              const selected = query.brand?.includes(bucket.key) ?? false;
              return (
                <div key={bucket.key} className="flex items-center gap-2">
                  <Checkbox
                    id={`brand-${bucket.key}`}
                    checked={selected}
                    onCheckedChange={(checked) => {
                      const current = new Set(query.brand ?? []);
                      if (checked) current.add(bucket.key);
                      else current.delete(bucket.key);
                      update('brand', [...current].join(','));
                    }}
                  />
                  <Label
                    htmlFor={`brand-${bucket.key}`}
                    className="flex-1 cursor-pointer capitalize"
                  >
                    {bucket.key}
                  </Label>
                  <span className="numeric text-muted-foreground text-xs">{bucket.count}</span>
                </div>
              );
            })}
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t('catalog.rating')}</legend>
        <div className="space-y-2">
          {[4, 3, 2].map((value) => (
            <div key={value} className="flex items-center gap-2">
              <Checkbox
                id={`rating-${value}`}
                checked={query.rating === value}
                onCheckedChange={(checked) => update('rating', checked ? String(value) : undefined)}
              />
              <Label htmlFor={`rating-${value}`} className="cursor-pointer">
                <span className="numeric">{value}</span> {t('catalog.andUp')}
              </Label>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t('catalog.availability')}</legend>
        <div className="flex items-center gap-2">
          <Checkbox
            id="in-stock"
            checked={query.inStock ?? false}
            onCheckedChange={(checked) => update('inStock', checked ? 'true' : undefined)}
          />
          <Label htmlFor="in-stock" className="cursor-pointer">
            {t('catalog.inStockOnly')}
          </Label>
        </div>
      </fieldset>

      <Button variant="outline" size="sm" className="w-full" onClick={() => setSearchParams({})}>
        {t('common.clearAll')}
      </Button>
    </div>
  );

  return (
    <div className="container py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">{title}</h1>
          {data && (
            <p className="text-muted-foreground mt-1 text-sm">
              {t('catalog.results', { count: data.meta.total })}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="lg:hidden">
                <SlidersHorizontal aria-hidden />
                {t('catalog.filters')}
              </Button>
            </SheetTrigger>
            <SheetContent side="start" className="overflow-y-auto">
              <SheetHeader>
                <SheetTitle>{t('catalog.filters')}</SheetTitle>
              </SheetHeader>
              <div className="p-6">{filters}</div>
            </SheetContent>
          </Sheet>

          <Select value={query.sort} onValueChange={(value) => update('sort', value)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder={t('catalog.sort')} />
            </SelectTrigger>
            <SelectContent>
              {PRODUCT_SORTS.map((sort) => (
                <SelectItem key={sort} value={sort}>
                  {t(SORT_LABEL[sort])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-24">{filters}</div>
        </aside>

        <div>
          {isError ? (
            <EmptyState
              title={t('errors.generic')}
              action={<Button onClick={() => void refetch()}>{t('common.retry')}</Button>}
            />
          ) : isLoading ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => (
                <ProductCardSkeleton key={index} />
              ))}
            </div>
          ) : data!.data.length === 0 ? (
            <EmptyState title={t('catalog.noResults')} description={t('catalog.noResultsHint')} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                {data!.data.map((product, index) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    priority={index < 4}
                    headingLevel="h2"
                  />
                ))}
              </div>

              <div className="mt-10">
                <Pagination
                  page={data!.meta.page}
                  totalPages={data!.meta.totalPages}
                  onChange={(page) => {
                    update('page', String(page));
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
