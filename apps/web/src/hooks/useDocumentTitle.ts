import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Sets the browser tab title for the current page.
 *
 * A single-page app never reloads the document, so without this every route
 * kept the title baked into index.html: fourteen pages all called "Sunshop".
 * That costs more than tidiness — tab switching, history, and bookmarks all
 * become guesswork, and a screen reader announces the same title on every
 * navigation, so nothing signals that the page changed.
 *
 * Pass `null` while data is still loading to leave the previous title in place
 * rather than flashing a bare app name between routes.
 */
export function useDocumentTitle(title: string | null | undefined): void {
  const { t } = useTranslation();
  const appName = t('common.appName');

  useEffect(() => {
    document.title = title ? `${title} · ${appName}` : appName;
  }, [title, appName]);
}
