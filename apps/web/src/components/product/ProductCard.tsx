import { discountPercent, type ProductCard as ProductCardData } from '@sunshop/shared';
import { ShoppingCart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { RatingStars } from '@/components/common/RatingStars';
import { WishlistButton } from '@/components/product/WishlistButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { localized, useFormat } from '@/lib/format';
import { cn, imageUrl, srcSet } from '@/lib/utils';
import { useUiStore } from '@/stores/ui';

interface ProductCardProps {
  product: ProductCardData;
  className?: string;
  onQuickAdd?: (product: ProductCardData) => void;
  /** Index in the grid: the first row is eagerly loaded for LCP. */
  priority?: boolean;
  /**
   * Heading level for the product name, which depends on where the card sits.
   * On the home page and the product page it follows an h2 section title, so
   * h3 is right. In the catalogue grid the cards are the page's own content
   * and h3 skips a level under the page h1.
   */
  headingLevel?: 'h2' | 'h3';
}

const BADGE_VARIANT = {
  new: 'default',
  sale: 'destructive',
  best_seller: 'success',
  low_stock: 'warning',
} as const;

/**
 * Catalogue card.
 *
 * Two details that matter more than they look:
 *  • The whole card is one link with an absolutely-positioned overlay, so the
 *    click target is the entire tile without nesting interactive elements
 *    inside an anchor (which breaks keyboard and screen-reader navigation).
 *  • `width`/`height` are set on the image so the grid reserves space and the
 *    page does not reflow as images arrive: the single biggest CLS win on a
 *    catalogue page.
 */
export function ProductCard({
  product,
  className,
  onQuickAdd,
  priority,
  headingLevel: Heading = 'h3',
}: ProductCardProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useUiStore((state) => state.locale);

  const name = localized(product.name, locale);

  const discount = product.compareAtPrice
    ? discountPercent(product.compareAtPrice, product.priceRange.min)
    : 0;

  return (
    <article
      className={cn(
        'bg-card hover:shadow-card-hover group relative flex flex-col overflow-hidden rounded-lg border transition-shadow',
        !product.inStock && 'opacity-75',
        className,
      )}
    >
      <div className="bg-muted relative aspect-square overflow-hidden">
        {product.image?.key ? (
          <img
            src={imageUrl(product.image.key, 640) ?? undefined}
            srcSet={srcSet(product.image.key)}
            sizes="(min-width: 1280px) 20vw, (min-width: 768px) 33vw, 50vw"
            alt={localized(product.image.alt, locale) || name}
            width={640}
            height={640}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            decoding="async"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="text-muted-foreground flex size-full items-center justify-center text-xs">
            {name.slice(0, 2)}
          </div>
        )}

        {/* Sits above the card-wide link overlay so the heart stays clickable. */}
        <WishlistButton productId={product.id} productName={name} />

        <div className="absolute start-2 top-2 flex flex-col gap-1">
          {product.badges.map((badge) => (
            <Badge key={badge} variant={BADGE_VARIANT[badge]} className="text-[10px]">
              {badge === 'sale' && discount > 0
                ? t('product.save', { percent: discount })
                : t(
                    `product.${badge === 'best_seller' ? 'bestSeller' : badge === 'low_stock' ? 'lowStock' : badge}`,
                  )}
            </Badge>
          ))}
        </div>

        {onQuickAdd && product.inStock && (
          <Button
            size="icon"
            className="absolute bottom-2 end-2 z-10 opacity-0 shadow-lg transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            onClick={(event) => {
              event.preventDefault();
              onQuickAdd(product);
            }}
            aria-label={`${t('product.addToCart')}: ${name}`}
          >
            <ShoppingCart aria-hidden />
          </Button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        {product.brand && (
          <span className="text-muted-foreground text-xs uppercase tracking-wide">
            {product.brand}
          </span>
        )}

        <Heading className="clamp-2 text-sm font-medium leading-snug">
          {/* Stretched link: covers the card without wrapping the buttons. */}
          <Link to={`/products/${product.slug}`} className="after:absolute after:inset-0">
            {name}
          </Link>
        </Heading>

        {product.rating.count > 0 && (
          <RatingStars value={product.rating.average} count={product.rating.count} />
        )}

        <div className="mt-auto flex flex-wrap items-baseline gap-2 pt-1">
          <span className="numeric font-semibold">
            {format.moneyRange(product.priceRange.min, product.priceRange.max)}
          </span>
          {discount > 0 && product.compareAtPrice && (
            <span className="numeric text-muted-foreground text-xs line-through">
              {format.money(product.compareAtPrice)}
            </span>
          )}
        </div>

        {!product.inStock && (
          <span className="text-destructive text-xs font-medium">{t('product.outOfStock')}</span>
        )}
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border">
      <Skeleton className="aspect-square rounded-none" />
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-2 h-5 w-20" />
      </div>
    </div>
  );
}
