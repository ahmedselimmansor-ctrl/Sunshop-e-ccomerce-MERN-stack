import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@sunshop/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ApiClientError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

export function LoginPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('auth.signInTitle'));
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((state) => state.login);
  const [needsTotp, setNeedsTotp] = useState(false);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: true },
  });

  /** Where to land after signing in: set by the route guard on redirect. */
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  async function onSubmit(values: LoginInput) {
    try {
      await login(values);
      navigate(from, { replace: true });
    } catch (error) {
      if (error instanceof ApiClientError) {
        // A TOTP-enabled account asks for the second factor on the same form
        // rather than bouncing to another screen.
        if (error.message.includes('authenticator') || error.code === 'UNAUTHORIZED') {
          if (!needsTotp && form.getValues('password')) setNeedsTotp(true);
        }
        form.setError('password', { message: error.message });
        toast.error(error.message);
      } else {
        toast.error(t('errors.generic'));
      }
    }
  }

  return (
    <div className="container flex min-h-[70vh] items-center justify-center py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle as="h1" className="text-2xl">
            {t('auth.signInTitle')}
          </CardTitle>
          <CardDescription>{t('auth.signInSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email" required>
                {t('auth.email')}
              </Label>
              <Input
                id="email"
                type="email"
                dir="ltr"
                autoComplete="email"
                invalid={Boolean(form.formState.errors.email)}
                {...form.register('email')}
              />
              {form.formState.errors.email && (
                <p role="alert" className="text-destructive text-xs">
                  {form.formState.errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" required>
                  {t('auth.password')}
                </Label>
                <Link to="/forgot-password" className="text-primary text-xs hover:underline">
                  {t('auth.forgotPassword')}
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                dir="ltr"
                autoComplete="current-password"
                invalid={Boolean(form.formState.errors.password)}
                {...form.register('password')}
              />
              {form.formState.errors.password && (
                <p role="alert" className="text-destructive text-xs">
                  {form.formState.errors.password.message}
                </p>
              )}
            </div>

            {needsTotp && (
              <div className="space-y-1.5">
                <Label htmlFor="totp">{t('auth.totpCode')}</Label>
                <Input
                  id="totp"
                  inputMode="numeric"
                  maxLength={6}
                  dir="ltr"
                  autoComplete="one-time-code"
                  className="numeric tracking-widest"
                  {...form.register('totpCode')}
                />
                <p className="text-muted-foreground text-xs">{t('auth.totpHint')}</p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Checkbox
                id="remember"
                checked={form.watch('rememberMe')}
                onCheckedChange={(checked) => form.setValue('rememberMe', Boolean(checked))}
              />
              <Label htmlFor="remember" className="cursor-pointer font-normal">
                {t('auth.rememberMe')}
              </Label>
            </div>

            <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
              {t('nav.signIn')}
            </Button>

            <p className="text-muted-foreground text-center text-sm">
              {t('auth.noAccount')}{' '}
              <Link to="/register" className="text-primary font-medium hover:underline">
                {t('nav.signUp')}
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
