import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useUiStore } from '@/stores/ui';

/**
 * Three-state theme control: light, dark, and follow-the-system.
 *
 * "System" is offered explicitly rather than inferred, because a user whose OS
 * switches at sunset should not have to re-pick every evening: and one who
 * wants dark all day should not be overridden at dawn.
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const theme = useUiStore((state) => state.theme);
  const resolved = useUiStore((state) => state.resolvedTheme);
  const setTheme = useUiStore((state) => state.setTheme);

  const options = [
    { value: 'light' as const, label: t('common.themeLight'), icon: Sun },
    { value: 'dark' as const, label: t('common.themeDark'), icon: Moon },
    { value: 'system' as const, label: t('common.themeSystem'), icon: Monitor },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('common.theme')}>
          {resolved === 'dark' ? <Moon aria-hidden /> : <Sun aria-hidden />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => setTheme(option.value)}
            className={theme === option.value ? 'bg-accent text-accent-foreground' : undefined}
          >
            <option.icon className="size-4" aria-hidden />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
