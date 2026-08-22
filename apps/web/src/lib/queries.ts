import {
  type AddToCartInput,
  type ChangePasswordInput,
  type Cart,
  type CategoryNode,
  type CheckoutInput,
  type Order,
  type PaginationMeta,
  type Product,
  type ProductCard,
  type ProductListQuery,
  type Review,
  type SavedAddress,
  type SearchFacets,
  type SessionDevice,
  type ShippingMethod,
  type Suggestion,
  type UpdateProfileInput,
  type User,
} from '@sunshop/shared';
import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';

import { ApiClientError, api, toQuery } from './api';

/**
 * Query client.
 *
 * Catalogue data is cached for a minute and served stale-while-revalidating:
 * a product grid that repaints on every back-navigation feels broken. Anything
 * user-specific (cart, orders) is not cached across mounts, because a stale
 * cart is a support ticket.
 *
 * Retries deliberately exclude 4xx: retrying a 403 three times just delays the
 * error the user needs to see.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiClientError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

export const queryKeys = {
  config: ['config'] as const,
  categories: ['categories', 'tree'] as const,
  products: (query: Partial<ProductListQuery>) => ['products', query] as const,
  product: (idOrSlug: string) => ['product', idOrSlug] as const,
  related: (id: string) => ['product', id, 'related'] as const,
  suggestions: (term: string) => ['suggest', term] as const,
  cart: ['cart'] as const,
  orders: (page: number) => ['orders', page] as const,
  order: (idOrNumber: string) => ['order', idOrNumber] as const,
  reviews: (productId: string, page: number) => ['reviews', productId, page] as const,
  shipping: (country: string, subtotal: number) => ['shipping', country, subtotal] as const,
};

// ── Storefront config ───────────────────────────────────────────────────────

export interface StoreConfig {
  storeName: { en: string; ar: string };
  supportEmail: string;
  defaultCurrency: string;
  defaultLocale: string;
  locales: string[];
  freeShippingThreshold: { amount: number; currency: string } | null;
  announcement: { enabled: boolean; text?: { en: string; ar: string }; href?: string | null };
  socialLinks: Record<string, string | null>;
  features: Record<string, boolean>;
  cdnBaseUrl: string;
}

export function useStoreConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => api.get<StoreConfig>('/config'),
    // Store settings change rarely; an hour of staleness is invisible.
    staleTime: 60 * 60_000,
  });
}

// ── Catalogue ───────────────────────────────────────────────────────────────

export function useCategoryTree() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => api.get<CategoryNode[]>('/categories/tree'),
    staleTime: 15 * 60_000,
  });
}

export interface ProductListResponse {
  data: ProductCard[];
  meta: PaginationMeta;
  facets: SearchFacets | null;
}

export function useProducts(query: Partial<ProductListQuery>, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.products(query),
    queryFn: async () => {
      const path = query.q ? '/search' : '/products';
      const response = await api.list<ProductCard>(
        `${path}${toQuery(query as Record<string, unknown>)}`,
      );
      return response as ProductListResponse;
    },
    enabled: options?.enabled ?? true,
    // Keeps the previous page visible while the next one loads, so pagination
    // does not flash an empty grid.
    placeholderData: (previous) => previous,
  });
}

export function useProduct(idOrSlug: string, options?: Partial<UseQueryOptions<Product>>) {
  return useQuery({
    queryKey: queryKeys.product(idOrSlug),
    queryFn: () => api.get<Product>(`/products/${encodeURIComponent(idOrSlug)}`),
    ...options,
  });
}

export function useRelatedProducts(productId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.related(productId ?? ''),
    queryFn: () => api.get<ProductCard[]>(`/products/${productId}/related`),
    enabled: Boolean(productId),
  });
}

export function useSuggestions(term: string) {
  return useQuery({
    queryKey: queryKeys.suggestions(term),
    queryFn: () => api.get<Suggestion[]>(`/search/suggest${toQuery({ q: term, limit: 8 })}`),
    enabled: term.trim().length >= 2,
    staleTime: 120_000,
  });
}

// ── Cart ────────────────────────────────────────────────────────────────────

export function useCart() {
  return useQuery({
    queryKey: queryKeys.cart,
    queryFn: () => api.get<Cart>('/cart'),
    staleTime: 0,
  });
}

/**
 * All cart mutations funnel through here so every one of them writes the
 * server's authoritative cart straight into the cache. Optimistic local
 * arithmetic on totals would drift from the server's pricing (tax, coupon caps,
 * free-shipping thresholds) within one edge case.
 */
function useCartMutation<TInput>(mutate: (input: TInput) => Promise<Cart>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: mutate,
    onSuccess: (cart) => client.setQueryData(queryKeys.cart, cart),
  });
}

export function useAddToCart() {
  return useCartMutation<AddToCartInput>((input) => api.post<Cart>('/cart/items', input));
}

export function useUpdateCartItem() {
  return useCartMutation<{ itemId: string; quantity: number }>(({ itemId, quantity }) =>
    api.patch<Cart>(`/cart/items/${itemId}`, { quantity }),
  );
}

export function useRemoveCartItem() {
  return useCartMutation<string>((itemId) => api.delete<Cart>(`/cart/items/${itemId}`));
}

export function useApplyCoupon() {
  return useCartMutation<string>((code) => api.post<Cart>('/cart/coupon', { code }));
}

export function useRemoveCoupon() {
  return useCartMutation<void>(() => api.delete<Cart>('/cart/coupon'));
}

// ── Checkout & orders ───────────────────────────────────────────────────────

export function useShippingMethods(country: string, subtotal: number, currency: string) {
  return useQuery({
    queryKey: queryKeys.shipping(country, subtotal),
    queryFn: () =>
      api.get<ShippingMethod[]>(
        `/orders/shipping-methods${toQuery({ country, subtotal, currency })}`,
      ),
    enabled: country.length === 2,
  });
}

export function useCheckout() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: CheckoutInput) =>
      api.post<Order>('/orders/checkout', input, {
        /**
         * A fresh key per checkout *attempt*, held for the lifetime of this
         * mutation: so a double-click or a retry after a network timeout
         * replays the first order instead of placing a second one.
         */
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.cart });
      void client.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useOrders(page = 1) {
  return useQuery({
    queryKey: queryKeys.orders(page),
    queryFn: () => api.list<Order>(`/orders${toQuery({ page, limit: 10 })}`),
  });
}

export function useOrder(idOrNumber: string) {
  return useQuery({
    queryKey: queryKeys.order(idOrNumber),
    queryFn: () => api.get<Order>(`/orders/${encodeURIComponent(idOrNumber)}`),
    enabled: Boolean(idOrNumber),
  });
}

export function useCancelOrder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<Order>(`/orders/${id}/cancel`, { reason }),
    onSuccess: (order) => {
      client.setQueryData(queryKeys.order(order.id), order);
      void client.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

// ── Reviews ─────────────────────────────────────────────────────────────────

export function useReviews(productId: string, page = 1) {
  return useQuery({
    queryKey: queryKeys.reviews(productId, page),
    queryFn: () => api.list<Review>(`/reviews${toQuery({ productId, page, limit: 10 })}`),
    enabled: Boolean(productId),
  });
}

// ── Wishlist ────────────────────────────────────────────────────────────────

export const wishlistKeys = {
  all: ['wishlist'] as const,
  ids: ['wishlist', 'ids'] as const,
};

export function useWishlist() {
  return useQuery({
    queryKey: wishlistKeys.all,
    queryFn: () => api.get<ProductCard[]>('/wishlist'),
  });
}

/**
 * Just the saved ids, so a catalogue grid can paint its hearts without
 * fetching every saved product's full card.
 */
export function useWishlistIds(enabled: boolean) {
  return useQuery({
    queryKey: wishlistKeys.ids,
    queryFn: () => api.get<string[]>('/wishlist/ids'),
    enabled,
    staleTime: 60_000,
  });
}

export function useToggleWishlist() {
  const client = useQueryClient();

  return useMutation<void, Error, { productId: string; saved: boolean }, { previous: string[] }>({
    mutationFn: async ({ productId, saved }) => {
      if (saved) await api.delete<void>(`/wishlist/${productId}`);
      else await api.post<{ productId: string }>('/wishlist', { productId });
    },

    // Optimistic: a heart that waits for a round trip feels broken.
    onMutate: async ({ productId, saved }) => {
      await client.cancelQueries({ queryKey: wishlistKeys.ids });
      const previous = client.getQueryData<string[]>(wishlistKeys.ids) ?? [];

      client.setQueryData<string[]>(
        wishlistKeys.ids,
        saved ? previous.filter((id) => id !== productId) : [...previous, productId],
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) client.setQueryData(wishlistKeys.ids, context.previous);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: wishlistKeys.all });
      void client.invalidateQueries({ queryKey: wishlistKeys.ids });
    },
  });
}

// ── Account ─────────────────────────────────────────────────────────────────

export const accountKeys = {
  profile: ['account', 'profile'] as const,
  sessions: ['account', 'sessions'] as const,
};

export function useProfile() {
  return useQuery({
    queryKey: accountKeys.profile,
    queryFn: () => api.get<User>('/users/me'),
  });
}

export function useUpdateProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => api.patch<User>('/users/me', input),
    onSuccess: (user) => client.setQueryData(accountKeys.profile, user),
  });
}

export function useAddAddress() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SavedAddress) => api.post<User>('/users/me/addresses', input),
    onSuccess: (user) => client.setQueryData(accountKeys.profile, user),
  });
}

export function useUpdateAddress() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SavedAddress }) =>
      api.patch<User>(`/users/me/addresses/${id}`, input),
    onSuccess: (user) => client.setQueryData(accountKeys.profile, user),
  });
}

export function useDeleteAddress() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<User>(`/users/me/addresses/${id}`),
    onSuccess: (user) => client.setQueryData(accountKeys.profile, user),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: accountKeys.sessions,
    queryFn: () => api.get<SessionDevice[]>('/auth/sessions'),
  });
}

export function useRevokeSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/auth/sessions/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: accountKeys.sessions }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      api.post<{ message: string }>('/auth/change-password', input),
  });
}

export function useCreateReview(productId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { rating: number; title?: string; body: string }) =>
      api.post<Review>('/reviews', { productId, ...input }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['reviews', productId] });
      void client.invalidateQueries({ queryKey: queryKeys.product(productId) });
    },
  });
}
