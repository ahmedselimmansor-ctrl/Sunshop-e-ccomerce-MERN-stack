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
        <span className="text-muted-foreground/35 inline-flex">
          {Array.from({ length: 5 }, (_, index) => (
            <Star key={index} className={starSize} fill="currentColor" strokeWidth={0} />
          ))}
        </span>
        {/* Clipped overlay: width is the exact fraction, direction-safe. */}
        <span
          className="text-warning absolute inset-0 inline-flex overflow-hidden rtl:flex-row-reverse"
          style={{ width: `${percentage}%` }}
        >
          {Array.from({ length: 5 }, (_, index) => (
            <Star key={index} className={starSize} fill="currentColor" strokeWidth={0} />
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
