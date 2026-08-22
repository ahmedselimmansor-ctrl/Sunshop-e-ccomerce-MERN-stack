import { create } from 'zustand';

import { api, setAccessToken, setUnauthenticatedHandler } from '@/lib/api';

import type {
  AuthResponse,
  LoginInput,
  Permission,
  RegisterInput,
  SessionUser,
} from '@sunshop/shared';

/**
 * Authentication state.
 *
 * Note what is *not* persisted: the access token. It lives in the API client's
 * module scope and is re-obtained on load by calling `/auth/refresh`, which
 * succeeds only if the httpOnly refresh cookie is still valid. Persisting the
 * token to `localStorage` would make "stay signed in" a one-line change and an
 * XSS jackpot; this way the durable credential is never reachable from
 * JavaScript at all.
 */
interface AuthState {
  user: SessionUser | null;
  /** True until the initial refresh attempt settles: guards route redirects. */
  initializing: boolean;
  loading: boolean;

  initialize: () => Promise<void>;
  login: (input: LoginInput) => Promise<SessionUser>;
  register: (input: RegisterInput) => Promise<SessionUser>;
  logout: (allDevices?: boolean) => Promise<void>;
  refreshUser: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  initializing: true,
  loading: false,

  /**
   * Runs once at boot. A failed refresh is the *normal* path for a first-time
   * visitor, so it resolves quietly rather than surfacing an error.
   */
  initialize: async () => {
    try {
      const response = await api.post<AuthResponse>('/auth/refresh', {}, { skipAuthRetry: true });
      setAccessToken(response.tokens.accessToken);
      set({ user: response.user });
    } catch {
      setAccessToken(null);
      set({ user: null });
    } finally {
      set({ initializing: false });
    }
  },

  login: async (input) => {
    set({ loading: true });
    try {
      const response = await api.post<AuthResponse>('/auth/login', input);
      setAccessToken(response.tokens.accessToken);
      set({ user: response.user });

      // Carry an anonymous basket into the account rather than dropping it.
      const guestToken = localStorage.getItem('sunshop-cart-token');
      if (guestToken) {
        await api
          .post('/cart/merge', { guestCartToken: guestToken, strategy: 'merge' })
          .catch(() => undefined);
        localStorage.removeItem('sunshop-cart-token');
      }

      return response.user;
    } finally {
      set({ loading: false });
    }
  },

  register: async (input) => {
    set({ loading: true });
    try {
      const response = await api.post<AuthResponse>('/auth/register', input);
      setAccessToken(response.tokens.accessToken);
      set({ user: response.user });
      return response.user;
    } finally {
      set({ loading: false });
    }
  },

  logout: async (allDevices = false) => {
    try {
      await api.post('/auth/logout', { allDevices });
    } finally {
      setAccessToken(null);
      set({ user: null });
    }
  },

  refreshUser: async () => {
    if (!get().user) return;
    const user = await api.get<SessionUser>('/auth/me').catch(() => null);
    if (user) set({ user });
  },

  /**
   * Client-side permission check: for hiding UI only. Every one of these is
   * re-enforced server-side; treating this as a security boundary would mean
   * shipping the store's authorization model to the browser and trusting it.
   */
  can: (permission) => get().user?.permissions.includes(permission) ?? false,
}));

/** A hard 401 from any request drops the client-side session. */
setUnauthenticatedHandler(() => {
  useAuthStore.setState({ user: null });
});
