import { Heart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useToggleWishlist, useWishlistIds } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

interface WishlistButtonProps {
  productId: string;
  productName: string;
  variant?: 'icon' | 'full';
  className?: string;
}

/**
 * Save-for-later toggle.
 *
 * A guest who taps it is sent to sign-in rather than shown a silent failure,
 * because a wishlist is per-account by definition and pretending otherwise
 * would lose the item at the next page load.
 */
export function WishlistButton({
  productId,
  productName,
  variant = 'icon',
  className,
}: WishlistButtonProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.user !== null);

  const { data: savedIds } = useWishlistIds(isAuthenticated);
  const toggle = useToggleWishlist();

  const saved = (savedIds ?? []).includes(productId);
  const label = saved ? t('wishlist.remove') : t('wishlist.add');

  // The icon variant repeats down a grid of cards with nothing but a heart to
  // tell the instances apart, so its accessible name carries the product. The
  // full variant sits under the product's own heading and does not need it.
  const iconLabel = saved
    ? t('wishlist.removeNamed', { name: productName })
    : t('wishlist.addNamed', { name: productName });

  function onClick(event: React.MouseEvent) {
    // The button often sits inside a card that is itself a link.
    event.preventDefault();
    event.stopPropagation();

    if (!isAuthenticated) {
      navigate('/login', { state: { from: window.location.pathname } });
      return;
    }

    toggle.mutate(
      { productId, saved },
      {
        onSuccess: () =>
          toast.success(saved ? t('wishlist.removed') : t('wishlist.added'), {
            description: productName,
          }),
        onError: () => toast.error(t('errors.generic')),
      },
    );
  }

  if (variant === 'full') {
    return (
      <Button type="button" variant="outline" onClick={onClick} className={className}>
        <Heart className={cn('size-4', saved && 'fill-destructive text-destructive')} aria-hidden />
        {label}
      </Button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={iconLabel}
      aria-pressed={saved}
      className={cn(
        'bg-background/85 hover:bg-background absolute end-2 top-2 z-10 grid size-8 place-items-center rounded-full shadow-sm backdrop-blur transition-colors',
        className,
      )}
    >
      <Heart
        className={cn(
          'size-4 transition-colors',
          saved ? 'fill-destructive text-destructive' : 'text-muted-foreground',
        )}
        aria-hidden
      />
    </button>
  );
}
