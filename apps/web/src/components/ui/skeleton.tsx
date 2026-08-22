import { cn } from '@/lib/utils';

/** Placeholder block. `aria-hidden` so screen readers skip the shimmer. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('skeleton rounded-md', className)} {...props} />;
}

export { Skeleton };
