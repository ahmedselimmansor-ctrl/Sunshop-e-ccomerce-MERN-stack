import {
  STAFF_ROLES,
  type AuthResponse,
  type LoginInput,
  type Permission,
  type SessionUser,
} from '@sunshop/shared';
import { create } from 'zustand';

import { api, setAccessToken, setUnauthenticatedHandler } from '@/lib/api';

/**
 * Staff session.
 *
 * The dashboard refuses to hold a session for a non-staff account: a customer
 * who signs in here is signed straight back out with a clear message, rather
 * than landing on a shell full of 403s. This is a UX guard only: every admin
 * endpoint enforces the same rule server-side.
 */
interface AdminAuthState {
  user: SessionUser | null;
  initializing: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  login: (input: LoginInput) => Promise<SessionUser>;
  logout: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

function isStaff(user: SessionUser): boolean {
  return user.roles.some((role) => (STAFF_ROLES as readonly string[]).includes(role));
}

export const useAuthStore = create<AdminAuthState>()((set, get) => ({
  user: null,
  initializing: true,
  error: null,

  initialize: async () => {
    try {
      const response = await api.post<AuthResponse>('/auth/refresh', {}, { skipAuthRetry: true });
      setAccessToken(response.tokens.accessToken);
      set({ user: isStaff(response.user) ? response.user : null });
    } catch {
      setAccessToken(null);
      set({ user: null });
    } finally {
      set({ initializing: false });
    }
  },

  login: async (input) => {
    set({ error: null });
    const response = await api.post<AuthResponse>('/auth/login', input);

    if (!isStaff(response.user)) {
      // Drop the session immediately rather than leaving a customer holding a
      // dashboard token.
      await api.post('/auth/logout', { allDevices: false }).catch(() => undefined);
      setAccessToken(null);
      throw new Error('NOT_STAFF');
    }

    setAccessToken(response.tokens.accessToken);
    set({ user: response.user });
    return response.user;
  },

  logout: async () => {
    try {
      await api.post('/auth/logout', { allDevices: false });
    } finally {
      setAccessToken(null);
      set({ user: null });
    }
  },

  can: (permission) => get().user?.permissions.includes(permission) ?? false,
}));

setUnauthenticatedHandler(() => {
  useAuthStore.setState({ user: null });
});
