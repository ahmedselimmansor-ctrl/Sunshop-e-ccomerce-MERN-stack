import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@sunshop/shared';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ApiClientError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

export function LoginPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('auth.title'));
  const login = useAuthStore((state) => state.login);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });

  async function onSubmit(values: LoginInput) {
    setMessage(null);
    try {
      await login(values);
    } catch (error) {
      if (error instanceof Error && error.message === 'NOT_STAFF') {
        setMessage(t('auth.notStaff'));
        return;
      }
      if (error instanceof ApiClientError) {
        if (error.message.toLowerCase().includes('authenticator')) setNeedsTotp(true);
        setMessage(error.message);
        return;
      }
      setMessage(t('errors.generic'));
    }
  }

  return (
    <div className="bg-muted/30 flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="bg-primary text-primary-foreground mb-2 flex size-10 items-center justify-center rounded-lg">
            S
          </div>
          <CardTitle as="h1">{t('auth.title')}</CardTitle>
          <CardDescription>{t('auth.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            {message && (
              <div
                role="alert"
                className="border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border p-3 text-sm"
              >
                <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {message}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email" required>
                {t('auth.email')}
              </Label>
              <Input
                id="email"
                type="email"
                dir="ltr"
                autoComplete="username"
                {...form.register('email')}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" required>
                {t('auth.password')}
              </Label>
              <Input
                id="password"
                type="password"
                dir="ltr"
                autoComplete="current-password"
                {...form.register('password')}
              />
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
                  className="numeric tracking-[0.4em]"
                  {...form.register('totpCode')}
                />
              </div>
            )}

            <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
              {t('auth.signIn')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
