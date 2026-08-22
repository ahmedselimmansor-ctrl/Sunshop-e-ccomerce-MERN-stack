import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema, type ChangePasswordInput } from '@sunshop/shared';
import { Laptop, LogOut, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ApiClientError } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useChangePassword, useRevokeSession, useSessions } from '@/lib/queries';
import { useAuthStore } from '@/stores/auth';

/**
 * Security settings.
 *
 * The session list is the part that earns its place: it is the only way a user
 * can tell that someone else is signed in as them, and the only self-service
 * way to end that session.
 */
export function SecurityPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('account.security'));
  const format = useFormat();
  const { data: sessions, isLoading } = useSessions();
  const revoke = useRevokeSession();
  const changePassword = useChangePassword();
  const logout = useAuthStore((state) => state.logout);

  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: ChangePasswordInput) {
    try {
      await changePassword.mutateAsync(values);
      form.reset();
      toast.success(t('account.saved'));
    } catch (error) {
      if (error instanceof ApiClientError) {
        for (const [path, message] of Object.entries(error.fieldErrors)) {
          form.setError(path as keyof ChangePasswordInput, { message });
        }
        toast.error(error.message);
      } else {
        toast.error(t('errors.generic'));
      }
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle as="h2">{t('account.changePassword')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword" required>
                {t('auth.currentPassword')}
              </Label>
              <Input
                id="currentPassword"
                type="password"
                dir="ltr"
                autoComplete="current-password"
                {...form.register('currentPassword')}
              />
              {form.formState.errors.currentPassword && (
                <p role="alert" className="text-destructive text-xs">
                  {form.formState.errors.currentPassword.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="newPassword" required>
                {t('auth.newPassword')}
              </Label>
              <Input
                id="newPassword"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                {...form.register('newPassword')}
              />
              {form.formState.errors.newPassword && (
                <p role="alert" className="text-destructive text-xs">
                  {form.formState.errors.newPassword.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword" required>
                {t('auth.confirmPassword')}
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                {...form.register('confirmPassword')}
              />
              {form.formState.errors.confirmPassword && (
                <p role="alert" className="text-destructive text-xs">
                  {form.formState.errors.confirmPassword.message}
                </p>
              )}
            </div>

            <Button type="submit" loading={form.formState.isSubmitting}>
              {t('common.save')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <ShieldCheck className="size-4" aria-hidden />
            {t('account.activeSessions')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <ul className="divide-y">
              {(sessions ?? []).map((session) => (
                <li key={session.id} className="flex items-center gap-3 py-3">
                  <Laptop className="text-muted-foreground size-4 shrink-0" aria-hidden />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{session.userAgent ?? t('common.loading')}</p>
                    <p className="numeric text-muted-foreground text-xs">
                      {session.ip} ·{' '}
                      {format.date(session.lastUsedAt, { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  </div>

                  {session.current ? (
                    <Badge variant="success">{t('common.yes')}</Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        revoke.mutate(session.id, {
                          onSuccess: () => toast.success(t('auth.signedOut')),
                        })
                      }
                    >
                      {t('nav.signOut')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              if (!window.confirm(t('account.signOutEverywhere'))) return;
              void logout(true);
            }}
          >
            <LogOut aria-hidden />
            {t('account.signOutEverywhere')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
