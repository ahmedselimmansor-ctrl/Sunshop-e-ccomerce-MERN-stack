import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterInput } from '@sunshop/shared';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ApiClientError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';

export function RegisterPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('auth.signUpTitle'));
  const navigate = useNavigate();
  const registerUser = useAuthStore((state) => state.register);
  const locale = useUiStore((state) => state.locale);

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      confirmPassword: '',
      locale,
      acceptTerms: false as never,
      marketingOptIn: false,
    },
  });

  async function onSubmit(values: RegisterInput) {
    try {
      await registerUser(values);
      toast.success(t('checkout.successTitle'));
      navigate('/', { replace: true });
    } catch (error) {
      if (error instanceof ApiClientError) {
        for (const [path, message] of Object.entries(error.fieldErrors)) {
          form.setError(path as keyof RegisterInput, { message });
        }
        toast.error(error.message);
      } else {
        toast.error(t('errors.generic'));
      }
    }
  }

  return (
    <div className="container flex min-h-[70vh] items-center justify-center py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle as="h1" className="text-2xl">
            {t('auth.signUpTitle')}
          </CardTitle>
          <CardDescription>{t('auth.signUpSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="firstName" required>
                  {t('auth.firstName')}
                </Label>
                <Input id="firstName" autoComplete="given-name" {...form.register('firstName')} />
                {form.formState.errors.firstName && (
                  <p role="alert" className="text-destructive text-xs">
                    {form.formState.errors.firstName.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName" required>
                  {t('auth.lastName')}
                </Label>
                <Input id="lastName" autoComplete="family-name" {...form.register('lastName')} />
                {form.formState.errors.lastName && (
                  <p role="alert" className="text-destructive text-xs">
                    {form.formState.errors.lastName.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email" required>
                {t('auth.email')}
              </Label>
              <Input
                id="email"
                type="email"
                dir="ltr"
                autoComplete="email"
                {...form.register('email')}
              />
              {form.formState.errors.email && (
                <p role="alert" className="text-destructive text-xs">
                  {form.formState.errors.email.message}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="password" required>
                  {t('auth.password')}
                </Label>
                <Input
                  id="password"
                  type="password"
                  dir="ltr"
                  autoComplete="new-password"
                  {...form.register('password')}
                />
                {form.formState.errors.password && (
                  <p role="alert" className="text-destructive text-xs">
                    {form.formState.errors.password.message}
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
            </div>

            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="terms"
                  checked={Boolean(form.watch('acceptTerms'))}
                  onCheckedChange={(checked) =>
                    form.setValue('acceptTerms', Boolean(checked) as never, {
                      shouldValidate: true,
                    })
                  }
                />
                <Label htmlFor="terms" className="cursor-pointer font-normal leading-snug">
                  {t('auth.acceptTerms')}
                </Label>
              </div>
              {form.formState.errors.acceptTerms && (
                <p role="alert" className="text-destructive text-xs">
                  {form.formState.errors.acceptTerms.message}
                </p>
              )}

              <div className="flex items-start gap-2">
                <Checkbox
                  id="marketing"
                  checked={form.watch('marketingOptIn')}
                  onCheckedChange={(checked) => form.setValue('marketingOptIn', Boolean(checked))}
                />
                <Label htmlFor="marketing" className="cursor-pointer font-normal leading-snug">
                  {t('auth.marketingOptIn')}
                </Label>
              </div>
            </div>

            <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
              {t('nav.signUp')}
            </Button>

            <p className="text-muted-foreground text-center text-sm">
              {t('auth.hasAccount')}{' '}
              <Link to="/login" className="text-primary font-medium hover:underline">
                {t('nav.signIn')}
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
