import { Heart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { EmptyState } from '@/components/common/EmptyState';
import { ProductCard, ProductCardSkeleton } from '@/components/product/ProductCard';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useWishlist } from '@/lib/queries';

export function WishlistPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.wishlist'));
  const { data: products, isLoading } = useWishlist();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <ProductCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (!products || products.length === 0) {
    return (
      <EmptyState
        icon={Heart}
        title={t('wishlist.empty')}
        description={t('wishlist.emptyHint')}
        action={
          <Button asChild>
            <Link to="/products">{t('cart.continueShopping')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display text-lg font-semibold">
        {t('nav.wishlist')}{' '}
        <span className="numeric text-muted-foreground font-normal">({products.length})</span>
      </h2>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
}
