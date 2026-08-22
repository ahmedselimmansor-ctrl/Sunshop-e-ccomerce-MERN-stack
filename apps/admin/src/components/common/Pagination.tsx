import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

/**
 * Page control.
 *
 * The chevrons are swapped under RTL by `rtl:rotate-180` rather than by
 * swapping the components: one class instead of a conditional that someone
 * will forget to mirror next time.
 */
export function Pagination({ page, totalPages, onChange }: PaginationProps) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;

  // A sliding window keeps the control the same width on page 2 and page 200.
  const window = 2;
  const pages: (number | 'gap')[] = [];
  for (let index = 1; index <= totalPages; index += 1) {
    const inWindow = Math.abs(index - page) <= window;
    const isEdge = index === 1 || index === totalPages;
    if (inWindow || isEdge) pages.push(index);
    else if (pages.at(-1) !== 'gap') pages.push('gap');
  }

  return (
    <nav className="flex items-center justify-center gap-1" aria-label="Pagination">
      <Button
        variant="outline"
        size="icon"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label={t('common.back')}
      >
        <ChevronLeft className="rtl:rotate-180" aria-hidden />
      </Button>

      {pages.map((entry, index) =>
        entry === 'gap' ? (
          <span key={`gap-${index}`} className="text-muted-foreground px-2">
            …
          </span>
        ) : (
          <Button
            key={entry}
            variant={entry === page ? 'default' : 'ghost'}
            size="icon"
            onClick={() => onChange(entry)}
            aria-current={entry === page ? 'page' : undefined}
            className="numeric"
          >
            {entry}
          </Button>
        ),
      )}

      <Button
        variant="outline"
        size="icon"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label={t('common.continue')}
      >
        <ChevronRight className="rtl:rotate-180" aria-hidden />
      </Button>
    </nav>
  );
}
