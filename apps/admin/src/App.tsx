import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';

import { AdminLayout } from '@/components/layout/AdminLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { AuditPage } from '@/features/audit/AuditPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { CategoriesPage } from '@/features/categories/CategoriesPage';
import { CouponsPage } from '@/features/coupons/CouponsPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { InventoryPage } from '@/features/inventory/InventoryPage';
import { OrderDetailPage } from '@/features/orders/OrderDetailPage';
import { OrdersPage } from '@/features/orders/OrdersPage';
import { ProductFormPage } from '@/features/products/ProductFormPage';
import { ProductsPage } from '@/features/products/ProductsPage';
import { ReviewsPage } from '@/features/reviews/ReviewsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { UsersPage } from '@/features/users/UsersPage';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';

export default function App() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const initializing = useAuthStore((state) => state.initializing);
  const initialize = useAuthStore((state) => state.initialize);
  const locale = useUiStore((state) => state.locale);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  if (initializing) {
    return (
      <div className="space-y-4 p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // One gate for the whole surface: unauthenticated staff see only the login
  // screen, and there is no route that renders the shell without a session.
  if (!user) {
    return (
      <>
        <LoginPage />
        <Toaster position={locale === 'ar' ? 'top-left' : 'top-right'} richColors />
      </>
    );
  }

  return (
    <>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/new" element={<ProductFormPage />} />
          <Route path="/products/:id/edit" element={<ProductFormPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
          <Route path="/customers" element={<UsersPage />} />
          <Route path="/coupons" element={<CouponsPage />} />
          <Route path="/reviews" element={<ReviewsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>

      <Toaster
        position={locale === 'ar' ? 'top-left' : 'top-right'}
        dir={locale === 'ar' ? 'rtl' : 'ltr'}
        richColors
        closeButton
      />
      <span className="sr-only">{t('common.appName')}</span>
    </>
  );
}
