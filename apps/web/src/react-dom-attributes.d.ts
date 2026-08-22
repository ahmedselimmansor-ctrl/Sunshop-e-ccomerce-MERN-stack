/**
 * `fetchpriority`, lowercase.
 *
 * The attribute tells the browser to fetch the LCP image ahead of the rest of
 * the queue, and it works: it reaches the DOM either way. The spelling is the
 * problem. `@types/react` 18 declares the camelCase `fetchPriority`, but
 * react-dom 18 has never heard of it, so every image logged
 *
 *   Warning: React does not recognize the `fetchPriority` prop on a DOM
 *   element ... spell it as lowercase `fetchpriority` instead.
 *
 * on every render. Twenty images per catalogue page is enough console noise to
 * teach a team to scroll past warnings, which is how a real one gets missed.
 *
 * react-dom passes unrecognised *lowercase* attributes through untouched, so
 * the lowercase spelling produces the same HTML silently. TypeScript needs to
 * be told it exists. Delete this file and switch the two call sites back to
 * `fetchPriority` when the app moves to React 19, which supports it natively.
 */
import 'react';

declare module 'react' {
  interface ImgHTMLAttributes<T> extends AriaAttributes, DOMAttributes<T> {
    fetchpriority?: 'high' | 'low' | 'auto';
  }
}
