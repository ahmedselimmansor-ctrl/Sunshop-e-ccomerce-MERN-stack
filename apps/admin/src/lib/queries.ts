import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiClientError, api, toQuery } from './api';

import type {
  AdminUserListQuery,
  CreateProductInput,
  AuditEntry,
  CategoryNode,
  Coupon,
  CreateCouponInput,
  Dashboard,
  Order,
  OrderListQuery,
  PaginationMeta,
  Product,
  ProductCard,
  ProductListQuery,
  Review,
  UpdateProductInput,
  Role,
  StoreSettings,
  UpdateSettingsInput,
  User,
} from '@sunshop/shared';

/**
 * Admin query layer.
 *
 * Staleness policy is the inverse of the storefront's: dashboards must not lie.
 * Lists refetch on window focus, because an operator who alt-tabs back after
 * fulfilling an order expects the table to reflect it.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiClientError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

export const adminKeys = {
  dashboard: (preset: string) => ['admin', 'dashboard', preset] as const,
  products: (query: unknown) => ['admin', 'products', query] as const,
  product: (id: string) => ['admin', 'product', id] as const,
  orders: (query: unknown) => ['admin', 'orders', query] as const,
  order: (id: string) => ['admin', 'order', id] as const,
  users: (query: unknown) => ['admin', 'users', query] as const,
  coupons: (query: unknown) => ['admin', 'coupons', query] as const,
  audit: (query: unknown) => ['admin', 'audit', query] as const,
  settings: ['admin', 'settings'] as const,
  categories: ['admin', 'categories'] as const,
  lowStock: ['admin', 'low-stock'] as const,
};

// ── Dashboard ───────────────────────────────────────────────────────────────

export function useDashboard(preset: '7d' | '30d' | '90d' | '12m') {
  return useQuery({
    queryKey: adminKeys.dashboard(preset),
    queryFn: () =>
      api.get<Dashboard>(
        `/admin/dashboard${toQuery({ preset, granularity: preset === '12m' ? 'month' : 'day' })}`,
      ),
  });
}

// ── Catalogue ───────────────────────────────────────────────────────────────

export function useAdminProducts(query: Partial<ProductListQuery>) {
  return useQuery({
    queryKey: adminKeys.products(query),
    queryFn: () =>
      api.list<ProductCard>(`/products${toQuery({ ...query, status: query.status ?? 'active' })}`),
    placeholderData: (previous) => previous,
  });
}

export function useAdminProduct(id: string) {
  return useQuery({
    queryKey: adminKeys.product(id),
    queryFn: () => api.get<Product>(`/products/${id}`),
    enabled: Boolean(id),
  });
}

export function useAdjustStock(productId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { variantId: string; delta: number; reason: string; note?: string }) =>
      api.post<{ stock: number }>(`/products/${productId}/stock`, input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'products'] });
      void client.invalidateQueries({ queryKey: adminKeys.product(productId) });
      void client.invalidateQueries({ queryKey: adminKeys.lowStock });
    },
  });
}

/** Prefix that matches every product list key, whatever its filters. */
const PRODUCTS_PREFIX = ['admin', 'products'] as const;

export function useCreateProduct() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductInput) => api.post<Product>('/products', input),
    onSuccess: () => client.invalidateQueries({ queryKey: PRODUCTS_PREFIX }),
  });
}

export function useUpdateProduct(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProductInput) => api.patch<Product>(`/products/${id}`, input),
    onSuccess: (product) => {
      client.setQueryData(adminKeys.product(id), product);
      void client.invalidateQueries({ queryKey: PRODUCTS_PREFIX });
    },
  });
}

export function useDeleteProduct() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/products/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: PRODUCTS_PREFIX }),
  });
}

/**
 * Direct-to-S3 upload.
 *
 * The API only ever hands out a presigned POST policy; the bytes go straight to
 * object storage and never through a pod. `confirm` then verifies the object
 * actually landed before its key is attached to a product.
 */
export function useUploadImage() {
  return useMutation({
    mutationFn: async ({
      file,
      scope,
    }: {
      file: File;
      scope: 'product' | 'category' | 'brand';
    }) => {
      const presigned = await api.post<{
        url: string;
        fields: Record<string, string>;
        key: string;
        publicUrl: string;
      }>('/media/presign', {
        filename: file.name,
        contentType: file.type,
        size: file.size,
        scope,
      });

      const form = new FormData();
      // Policy fields must precede the file part, per the S3 POST spec.
      for (const [name, value] of Object.entries(presigned.fields)) form.append(name, value);
      form.append('file', file);

      const upload = await fetch(presigned.url, { method: 'POST', body: form });
      if (!upload.ok) throw new Error(`Upload failed with status ${upload.status}`);

      await api.post('/media/confirm', { key: presigned.key });
      return { key: presigned.key, url: presigned.publicUrl };
    },
  });
}

export function useBulkProductAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[]; action: string }) =>
      api.post<{ modified: number }>('/products/bulk', input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin', 'products'] }),
  });
}

// ── Orders ──────────────────────────────────────────────────────────────────

export function useAdminOrders(query: Partial<OrderListQuery>) {
  return useQuery({
    queryKey: adminKeys.orders(query),
    queryFn: () => api.list<Order>(`/orders${toQuery(query as Record<string, unknown>)}`),
    placeholderData: (previous) => previous,
  });
}

export function useAdminOrder(id: string) {
  return useQuery({
    queryKey: adminKeys.order(id),
    queryFn: () => api.get<Order>(`/orders/${id}`),
    enabled: Boolean(id),
  });
}

export function useUpdateOrderStatus(orderId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { status: string; note?: string; restock?: boolean }) =>
      api.patch<Order>(`/orders/${orderId}/status`, input),
    onSuccess: (order) => {
      client.setQueryData(adminKeys.order(orderId), order);
      void client.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
  });
}

export function useAddShipment(orderId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      carrier: string;
      trackingNumber: string;
      trackingUrl?: string;
      notifyCustomer: boolean;
    }) => api.post<Order>(`/orders/${orderId}/shipments`, input),
    onSuccess: (order) => client.setQueryData(adminKeys.order(orderId), order),
  });
}

export function useRefundOrder(orderId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      amount?: { amount: number; currency: string };
      reason: string;
      note?: string;
      restock: boolean;
    }) =>
      api.post<Order>(`/orders/${orderId}/refund`, input, {
        // Refunds move money: a retried click must not refund twice.
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (order) => {
      client.setQueryData(adminKeys.order(orderId), order);
      void client.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
  });
}

// ── Users ───────────────────────────────────────────────────────────────────

export function useAdminUsers(query: Partial<AdminUserListQuery>) {
  return useQuery({
    queryKey: adminKeys.users(query),
    queryFn: () => api.list<User>(`/users${toQuery(query as Record<string, unknown>)}`),
    placeholderData: (previous) => previous,
  });
}

export function useAssignRoles(userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { roles: Role[]; reason: string }) =>
      api.patch<User>(`/users/${userId}/roles`, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useSuspendUser(userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { status: string; reason: string }) =>
      api.patch<User>(`/users/${userId}`, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

// ── Coupons ─────────────────────────────────────────────────────────────────

export function useCoupons(query: { page: number; limit: number; q?: string }) {
  return useQuery({
    queryKey: adminKeys.coupons(query),
    queryFn: () => api.list<Coupon>(`/admin/coupons${toQuery(query)}`),
  });
}

export function useCreateCoupon() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCouponInput) => api.post<Coupon>('/admin/coupons', input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin', 'coupons'] }),
  });
}

export function useDeleteCoupon() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/admin/coupons/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin', 'coupons'] }),
  });
}

// ── Categories ──────────────────────────────────────────────────────────────

export function useCategoryTree() {
  return useQuery({
    queryKey: adminKeys.categories,
    queryFn: () => api.get<CategoryNode[]>('/categories/tree'),
    staleTime: 60_000,
  });
}

// ── Inventory ───────────────────────────────────────────────────────────────

export interface LowStockRow {
  productId: string;
  variantId: string;
  sku: string;
  name: { en: string; ar: string };
  stock: number;
  threshold: number;
}

export function useLowStock(threshold?: number) {
  return useQuery({
    queryKey: [...adminKeys.lowStock, threshold ?? 'default'],
    queryFn: () => api.get<LowStockRow[]>(`/products/low-stock${toQuery({ threshold })}`),
  });
}

// ── Reviews ─────────────────────────────────────────────────────────────────

export function useAdminReviews(query: { page: number; limit: number; status?: string }) {
  return useQuery({
    queryKey: ['admin', 'reviews', query],
    queryFn: () => api.list<Review>(`/reviews${toQuery(query)}`),
    placeholderData: (previous) => previous,
  });
}

export function useModerateReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: string; note?: string }) =>
      api.patch<Review>(`/reviews/${id}/moderate`, { status, moderationNote: note }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin', 'reviews'] }),
  });
}

export function useReplyToReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      api.post<Review>(`/reviews/${id}/reply`, { body }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin', 'reviews'] }),
  });
}

// ── Audit & settings ────────────────────────────────────────────────────────

export function useAuditLog(query: { page: number; limit: number; action?: string }) {
  return useQuery({
    queryKey: adminKeys.audit(query),
    queryFn: () => api.list<AuditEntry>(`/admin/audit${toQuery(query)}`),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: adminKeys.settings,
    queryFn: () => api.get<StoreSettings>('/admin/settings'),
  });
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) => api.patch<StoreSettings>('/admin/settings', input),
    onSuccess: (settings) => client.setQueryData(adminKeys.settings, settings),
  });
}

export type { PaginationMeta };
