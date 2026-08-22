import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges Tailwind classes so later ones win.
 *
 * `clsx` alone would leave `px-2 px-4` in the output and let the stylesheet's
 * source order decide; `twMerge` resolves the conflict to `px-4`, which is what
 * a caller passing an override always means.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export const CDN_URL: string = import.meta.env.VITE_CDN_URL ?? '';

/**
 * Builds a CDN URL for an image key.
 *
 * Absolute URLs pass through, which is how a seeded fallback image that could
 * not be uploaded still renders. The separator is chosen rather than hardcoded
 * because such a URL usually already carries its own query string, and a second
 * `?` would silently break it.
 */
export function imageUrl(key: string | null | undefined, width?: number): string | null {
  if (!key) return null;

  const base = /^https?:\/\//i.test(key)
    ? key
    : `${CDN_URL.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;

  if (!width) return base;

  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}w=${width}&fm=webp&q=82`;
}

/** `srcset` string for a responsive `<img>`. */
export function srcSet(key: string | null | undefined, widths = [320, 640, 960, 1280]): string {
  if (!key) return '';
  return widths.map((width) => `${imageUrl(key, width)} ${width}w`).join(', ');
}

export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/** Debounce for search-as-you-type and filter inputs. */
export function debounce<T extends (...args: never[]) => void>(fn: T, delayMs: number): T {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  }) as T;
}

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}
