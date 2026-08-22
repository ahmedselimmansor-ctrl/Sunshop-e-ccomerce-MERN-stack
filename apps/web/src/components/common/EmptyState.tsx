import { cn } from '@/lib/utils';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /**
   * Heading level for the title. h2 suits the common case, where this sits
   * inside a page that already has a heading. Pages that return an empty state
   * *instead of* their content (an empty cart, a product that 404s) render
   * no h1 at all otherwise, and this becomes the page heading.
   */
  titleAs?: 'h1' | 'h2';
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  titleAs: Title = 'h2',
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
      {Icon && (
        <span className="bg-muted text-muted-foreground mb-4 flex size-14 items-center justify-center rounded-full">
          <Icon className="size-6" aria-hidden />
        </span>
      )}
      <Title className="font-display text-lg font-semibold">{title}</Title>
      {description && <p className="text-muted-foreground mt-1 max-w-sm text-sm">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
