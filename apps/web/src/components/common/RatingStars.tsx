import { Star } from 'lucide-react';

import { cn } from '@/lib/utils';

interface RatingStarsProps {
  value: number;
  count?: number;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Star rating.
 *
 * The visual stars are `aria-hidden` and the value is exposed once as text:
 * otherwise a screen reader announces "star, star, star, star, star" and the
 * actual rating never arrives. The half-star fill is a clipped overlay rather
 * than a rounded value, so 4.3 does not render as 4.5.
 */
export function RatingStars({ value, count, size = 'sm', className }: RatingStarsProps) {
  const percentage = Math.max(0, Math.min(100, (value / 5) * 100));
  const starSize = size === 'sm' ? 'size-3.5' : 'size-5';

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
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
          {Array.from({ length: 5 }, (_, index) => (
            <Star key={index} className={cn(starSize, 'shrink-0')} fill="none" strokeWidth={1.5} />
          ))}
        </span>
        {/*
         * Clipped overlay: width is the exact fraction, direction-safe.
         *
         * `shrink-0` is what makes this a clip rather than a squeeze. These
         * stars are flex children of a box narrowed to the rating fraction,
         * and a flex child shrinks before it overflows, so without it all five
         * stars were compressed horizontally into that box: a 3.7 rendered as
         * five squashed stars rather than three and a bit. It looked plausible
         * only because the layer underneath was too faint to compare against.
         */}
        <span
          className="text-warning absolute inset-0 inline-flex overflow-hidden rtl:flex-row-reverse"
          style={{ width: `${percentage}%` }}
        >
          {Array.from({ length: 5 }, (_, index) => (
            <Star
              key={index}
              className={cn(starSize, 'shrink-0')}
              fill="currentColor"
              strokeWidth={1.5}
            />
          ))}
        </span>
      </span>
      {count !== undefined && (
        <span className="numeric text-muted-foreground text-xs">
          {value.toFixed(1)} ({count})
        </span>
      )}
    </span>
  );
}
