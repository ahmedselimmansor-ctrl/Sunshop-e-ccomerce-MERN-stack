import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useFormat } from '@/lib/format';
import { cn } from '@/lib/utils';

interface RatingStarsProps {
  value: number;
  count?: number;
  size?: 'sm' | 'md';
  className?: string;
}

const MAX = 5;

/**
 * Star rating.
 *
 * The stars are a picture of a number, so the whole widget is one `img` with
 * the number as its label. Rendering five `Star` elements without that leaves
 * a screen reader announcing "star, star, star, star, star", or, where no
 * count is passed and the numeric text is therefore hidden, announcing
 * nothing at all.
 */
export function RatingStars({ value, count, size = 'sm', className }: RatingStarsProps) {
  const { t } = useTranslation();
  const format = useFormat();

  /*
   * Clamped, and non-finite input floors to zero rather than passing through.
   *
   * `NaN` reaches the style attribute as `width: NaN%`, which is not a valid
   * declaration, so the browser drops it and `inset-0` stretches the overlay
   * to full width. A product whose rating failed to load would then display a
   * flawless five stars, which is the worst direction for this to fail in.
   */
  const rating = Number.isFinite(value) ? Math.min(MAX, Math.max(0, value)) : 0;
  const percentage = (rating / MAX) * 100;

  const hasCount = Number.isFinite(count);
  const displayRating = rating.toFixed(1);
  const starSize = size === 'sm' ? 'size-3.5' : 'size-5';

  const label = hasCount
    ? t('product.ratingSummary', { rating: displayRating, count })
    : t('product.ratingValue', { rating: displayRating });

  return (
    <span
      role="img"
      aria-label={label}
      className={cn('inline-flex items-center gap-1.5', className)}
    >
      <span className="relative inline-flex" aria-hidden>
        {/*
         * The empty stars are outlined, not filled grey.
         *
         * Two solid blobs cannot satisfy both contrast constraints at once. A
         * grey light enough to stay clearly "empty" beside the amber fill
         * disappeared into the background (it measured 2.0:1 in dark and 1.6:1
         * in light, against the 3:1 that WCAG 1.4.11 asks of a UI component),
         * and a grey dark enough to fix that dropped filled-versus-empty to
         * 1.6:1, so the two states stopped being distinguishable instead.
         *
         * An outline separates the states by shape rather than by lightness,
         * which leaves the colour free to carry contrast against the surface.
         */}
        <span className="text-muted-foreground inline-flex">
          {Array.from({ length: MAX }, (_, index) => (
            <Star key={index} className={cn(starSize, 'shrink-0')} fill="none" strokeWidth={1.5} />
          ))}
        </span>

        {/*
         * Clipped overlay: width is the exact fraction.
         *
         * `shrink-0` is what makes this a clip rather than a squeeze. These
         * stars are flex children of a box narrowed to the rating fraction,
         * and a flex child shrinks before it overflows, so without it all five
         * stars were compressed horizontally into that box: a 3.7 rendered as
         * five squashed stars rather than three and a bit. It looked plausible
         * only because the layer underneath was too faint to compare against.
         *
         * No direction override. `dir="rtl"` already lays a flex row out
         * right-to-left, so an `rtl:flex-row-reverse` here reversed it a second
         * time and the overlay ran left-to-right while the outlines underneath
         * ran right-to-left. The two rows then sat half a star apart, which is
         * what made an Arabic rating look doubled. Both layers use the same
         * direction, and `inset-0` plus a width anchors the clip to the correct
         * edge in either one.
         */}
        <span
          className="text-warning absolute inset-0 inline-flex overflow-hidden"
          style={{ width: `${percentage}%` }}
        >
          {Array.from({ length: MAX }, (_, index) => (
            <Star
              key={index}
              className={cn(starSize, 'shrink-0')}
              fill="currentColor"
              strokeWidth={1.5}
            />
          ))}
        </span>
      </span>

      {hasCount && (
        <span className="numeric text-muted-foreground text-xs" aria-hidden>
          {displayRating} ({format.number(count as number)})
        </span>
      )}
    </span>
  );
}
