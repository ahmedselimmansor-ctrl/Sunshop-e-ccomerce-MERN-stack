import { Suspense, lazy, type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';

import { CartDrawer } from '@/components/cart/CartDrawer';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { Skeleton } from '@/components/ui/skeleton';
import { CatalogPage } from '@/features/catalog/CatalogPage';
import { HomePage } from '@/features/home/HomePage';
import { NotFoundPage } from '@/features/NotFoundPage';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';

/**
 * Route-level code splitting.
 *
 * The catalogue and home page ship in the main bundle because they are the
 * first thing almost every visitor sees; checkout, account and the product page
 * are lazy, so a browsing session never downloads the Stripe SDK or the account
 * forms it will not use.
 */
const ProductPage = lazy(() =>
  import('@/features/product/ProductPage').then((module) => ({ default: module.ProductPage })),
);
const CartPage = lazy(() =>
  import('@/features/cart/CartPage').then((module) => ({ default: module.CartPage })),
);
const CheckoutPage = lazy(() =>
  import('@/features/checkout/CheckoutPage').then((module) => ({ default: module.CheckoutPage })),
);
const LoginPage = lazy(() =>
  import('@/features/auth/LoginPage').then((module) => ({ default: module.LoginPage })),
);
const RegisterPage = lazy(() =>
  import('@/features/auth/RegisterPage').then((module) => ({ default: module.RegisterPage })),
);
const AccountLayout = lazy(() =>
  import('@/features/account/AccountLayout').then((module) => ({ default: module.AccountLayout })),
);
const OrdersPage = lazy(() =>
  import('@/features/account/OrdersPage').then((module) => ({ default: module.OrdersPage })),
);
const OrderDetailPage = lazy(() =>
  import('@/features/account/OrderDetailPage').then((module) => ({
    default: module.OrderDetailPage,
  })),
);
const ProfilePage = lazy(() =>
  import('@/features/account/ProfilePage').then((module) => ({ default: module.ProfilePage })),
);
const AddressesPage = lazy(() =>
  import('@/features/account/AddressesPage').then((module) => ({ default: module.AddressesPage })),
);
const SecurityPage = lazy(() =>
  import('@/features/account/SecurityPage').then((module) => ({ default: module.SecurityPage })),
);
const WishlistPage = lazy(() =>
  import('@/features/account/WishlistPage').then((module) => ({ default: module.WishlistPage })),
);

/**
 * Auth gate.
 *
 * Waits for the initial refresh to settle before deciding: redirecting on the
 * first render would bounce a signed-in user to /login every time they reload,
 * because the session is restored asynchronously.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const initializing = useAuthStore((state) => state.initializing);
  const location = useLocation();

  if (initializing) return <PageFallback />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function PageFallback() {
  return (
    <div className="container space-y-4 py-12">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/**
 * Puts the reader at the start of the new page on navigation.
 *
 * A SPA changes the URL without reloading, so the browser does none of what it
 * normally would: the scroll position stays where it was and focus stays on
 * whatever link was clicked. For anyone tabbing or using a screen reader that
 * means the next Tab continues from the old page's navigation, with nothing
 * announcing that the content changed.
 *
 * The first render is skipped deliberately: stealing focus on initial load
 * would fight the browser's own restoration and jump past the skip link.
 */
function ResetOnNavigate() {
  const { pathname } = useLocation();
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);

  return null;
}

export default function App() {
  const { t } = useTranslation();
  const initialize = useAuthStore((state) => state.initialize);
  const locale = useUiStore((state) => state.locale);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Keyboard users reach the content without tabbing the whole header. */}
      <a
        href="#main"
        className="sr-only-focusable bg-primary text-primary-foreground absolute z-50 m-2 rounded-md px-4 py-2"
      >
        {t('common.skipToContent')}
      </a>

      <ResetOnNavigate />
      <Header />

      {/* tabIndex -1 so the skip link moves focus, not just scroll position:
          without it the next Tab returns to the header the link just skipped. */}
      <main id="main" tabIndex={-1} className="flex-1">
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/products" element={<CatalogPage />} />
            <Route path="/products/:slug" element={<ProductPage />} />
            <Route path="/categories/:slug" element={<CatalogPage mode="category" />} />
            <Route path="/search" element={<CatalogPage mode="search" />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            <Route
              path="/account"
              element={
                <RequireAuth>
                  <AccountLayout />
                </RequireAuth>
              }
            >
              <Route index element={<ProfilePage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="orders/:orderNumber" element={<OrderDetailPage />} />
              <Route path="addresses" element={<AddressesPage />} />
              <Route path="security" element={<SecurityPage />} />
              <Route path="wishlist" element={<WishlistPage />} />
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>

      <Footer />
      <CartDrawer />

      <Toaster
        position={locale === 'ar' ? 'top-left' : 'top-right'}
        dir={locale === 'ar' ? 'rtl' : 'ltr'}
        richColors
        closeButton
      />
    </div>
  );
}
