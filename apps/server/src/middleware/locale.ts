import {
  CURRENCIES,
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_HEADER,
  type Currency,
  type Locale,
} from '@sunshop/shared';

import { env } from '../config/env';
import { setContextValues } from '../observability/context';

import type { NextFunction, Request, Response } from 'express';

/**
 * Resolves the request locale and display currency.
 *
 * Precedence: explicit header (set by every Sunshop client) → `?lang=` query
 * (for shareable links and crawlers) → `Accept-Language` → default. The
 * response advertises `Content-Language` and varies on the header so
 * CloudFront caches Arabic and English separately instead of serving one to
 * everyone.
 */
export function resolveLocale(req: Request, res: Response, next: NextFunction): void {
  const locale = pickLocale(req);
  const currency = pickCurrency(req);

  req.locale = locale;
  req.currency = currency;
  setContextValues({ locale });

  res.setHeader('Content-Language', locale);
  res.vary(LOCALE_HEADER);
  res.vary('Accept-Language');

  next();
}

function pickLocale(req: Request): Locale {
  const header = req.get(LOCALE_HEADER)?.toLowerCase();
  if (isLocale(header)) return header;

  const queryLang = typeof req.query.lang === 'string' ? req.query.lang.toLowerCase() : undefined;
  if (isLocale(queryLang)) return queryLang;

  // Minimal Accept-Language parse: take the first supported tag by q-order.
  const accept = req.get('accept-language');
  if (accept) {
    const candidates = accept
      .split(',')
      .map((part) => {
        const [tag = '', qPart] = part.trim().split(';q=');
        return { tag: tag.split('-')[0]?.toLowerCase() ?? '', q: qPart ? Number(qPart) : 1 };
      })
      .sort((a, b) => b.q - a.q);

    for (const candidate of candidates) {
      if (isLocale(candidate.tag)) return candidate.tag;
    }
  }

  return DEFAULT_LOCALE;
}

function pickCurrency(req: Request): Currency {
  const header = req.get('x-currency')?.toUpperCase();
  if (isCurrency(header)) return header;
  return env.DEFAULT_CURRENCY as Currency;
}

function isLocale(value: string | undefined): value is Locale {
  return Boolean(value) && (LOCALES as readonly string[]).includes(value!);
}

function isCurrency(value: string | undefined): value is Currency {
  return Boolean(value) && (CURRENCIES as readonly string[]).includes(value!);
}
