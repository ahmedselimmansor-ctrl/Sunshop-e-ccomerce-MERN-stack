import { LOCALES, LOCALE_LABEL, type Locale } from '@sunshop/shared';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { changeLanguage } from '@/i18n';
import { queryClient } from '@/lib/queries';
import { useUiStore } from '@/stores/ui';

/**
 * Language switch.
 *
 * Changing locale flips `dir` on `<html>` (handled by the store) *and* clears
 * the query cache: product names, category names and error messages are all
 * localized server-side, so cached English payloads would keep showing through
 * an otherwise-Arabic page.
 */
export function LocaleSwitcher() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const setLocale = useUiStore((state) => state.setLocale);

  const select = (next: Locale) => {
    if (next === locale) return;
    setLocale(next);
    changeLanguage(next);
    void queryClient.invalidateQueries();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('common.language')}>
          <Globe aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {LOCALES.map((value) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => select(value)}
            lang={value}
            dir={value === 'ar' ? 'rtl' : 'ltr'}
            className={value === locale ? 'bg-accent text-accent-foreground' : undefined}
          >
            {LOCALE_LABEL[value]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
