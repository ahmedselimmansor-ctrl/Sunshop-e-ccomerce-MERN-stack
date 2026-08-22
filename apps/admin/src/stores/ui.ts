import { LOCALE_DIRECTION, type Locale, type Theme } from '@sunshop/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * UI preferences: theme and locale.
 *
 * Persisted under `sunshop-ui`, the same key the inline script in `index.html`
 * reads before first paint. Keeping the two in sync is what avoids a
 * light-then-dark flash and an LTR-then-RTL layout jump on load.
 *
 * State changes apply the DOM side effects directly rather than through a
 * `useEffect` in some component: `<html>` is outside React's tree, and routing
 * it through a component would make the correct behaviour depend on that
 * component staying mounted.
 */
interface UiState {
  theme: Theme;
  locale: Locale;
  /** Resolved from `theme`, following the OS when `theme === 'system'`. */
  resolvedTheme: 'light' | 'dark';
  cartOpen: boolean;
  mobileNavOpen: boolean;
  setTheme: (theme: Theme) => void;
  setLocale: (locale: Locale) => void;
  toggleTheme: () => void;
  setCartOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return theme;
}

function applyTheme(theme: Theme): 'light' | 'dark' {
  const resolved = resolve(theme);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = LOCALE_DIRECTION[locale];
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      locale: 'en',
      resolvedTheme: 'light',
      cartOpen: false,
      mobileNavOpen: false,

      setTheme: (theme) => set({ theme, resolvedTheme: applyTheme(theme) }),

      setLocale: (locale) => {
        applyLocale(locale);
        set({ locale });
      },

      toggleTheme: () => {
        // Toggling from `system` picks the opposite of what is showing, which
        // is what a user reaching for the switch actually wants.
        const next: Theme = get().resolvedTheme === 'dark' ? 'light' : 'dark';
        set({ theme: next, resolvedTheme: applyTheme(next) });
      },

      setCartOpen: (cartOpen) => set({ cartOpen }),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
    }),
    {
      name: 'sunshop-admin-ui',
      // Transient UI state must not survive a reload: reopening a drawer the
      // user closed yesterday is not "restoring their session".
      partialize: (state) => ({ theme: state.theme, locale: state.locale }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.resolvedTheme = applyTheme(state.theme);
        applyLocale(state.locale);
      },
    },
  ),
);

/**
 * Keeps `theme: 'system'` live: if the OS flips to dark at sunset, the app
 * follows without a reload. Registered once at module load.
 */
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { theme } = useUiStore.getState();
    if (theme === 'system') {
      useUiStore.setState({ resolvedTheme: applyTheme('system') });
    }
  });
}
