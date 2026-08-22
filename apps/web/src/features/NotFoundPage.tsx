import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export function NotFoundPage() {
  const { t } = useTranslation();

  useDocumentTitle(t('errors.notFound'));
  return (
    <div className="container flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="numeric font-display text-primary text-6xl font-bold">404</p>
      <h1 className="font-display mt-4 text-2xl font-bold">{t('errors.notFound')}</h1>
      <p className="text-muted-foreground mt-2 max-w-sm">{t('errors.notFoundHint')}</p>
      <Button asChild className="mt-8">
        <Link to="/">{t('errors.goHome')}</Link>
      </Button>
    </div>
  );
}
