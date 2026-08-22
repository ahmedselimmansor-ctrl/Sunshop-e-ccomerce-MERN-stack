import { zodResolver } from '@hookform/resolvers/zod';
import {
  LOCALES,
  LOCALE_LABEL,
  updateProfileSchema,
  type UpdateProfileInput,
} from '@sunshop/shared';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { changeLanguage } from '@/i18n';
import { ApiClientError } from '@/lib/api';
import { useProfile, useUpdateProfile } from '@/lib/queries';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';

/**
 * Profile settings.
 *
 * Changing the locale here updates the *account* preference, which is what
 * order confirmation emails are sent in. It also switches the interface, since
 * a user who picks Arabic and then keeps seeing English has reasonable grounds
 * to think the setting did nothing.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  useDocumentTitle(t('account.profile'));
  const { data: profile, isLoading } = useProfile();
  const update = useUpdateProfile();
  const refreshUser = useAuthStore((state) => state.refreshUser);
  const setLocale = useUiStore((state) => state.setLocale);

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { firstName: '', lastName: '', phone: '', marketingOptIn: false },
  });

  useEffect(() => {
    if (!profile) return;
    form.reset({
      firstName: profile.firstName,
      lastName: profile.lastName,
      phone: profile.phone ?? '',
      locale: profile.locale,
      marketingOptIn: profile.marketingOptIn,
    });
  }, [profile, form]);

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  async function onSubmit(values: UpdateProfileInput) {
    try {
      // An empty phone field means "remove it", which the API expresses as null.
      const payload = { ...values, phone: values.phone?.trim() ? values.phone : null };
      await update.mutateAsync(payload);

      if (values.locale) {
        setLocale(values.locale);
        changeLanguage(values.locale);
      }

      await refreshUser();
      toast.success(t('account.saved'));
    } catch (error) {
      if (error instanceof ApiClientError) {
        for (const [path, message] of Object.entries(error.fieldErrors)) {
          form.setError(path as keyof UpdateProfileInput, { message });
        }
        toast.error(error.message);
      } else {
        toast.error(t('errors.generic'));
      }
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle as="h2">{t('account.profile')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">{t('auth.firstName')}</Label>
              <Input id="firstName" {...form.register('firstName')} />
              {form.formState.errors.firstName && (
                <p role="alert" className="text-destructive text-xs">
                  {form.formState.errors.firstName.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">{t('auth.lastName')}</Label>
              <Input id="lastName" {...form.register('lastName')} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">{t('auth.email')}</Label>
            {/* Changing the login identifier needs a verification round trip,
                so it is deliberately not editable here. */}
            <Input id="email" value={profile?.email ?? ''} dir="ltr" disabled readOnly />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">{t('checkout.phone')}</Label>
            <Input
              id="phone"
              dir="ltr"
              placeholder="+201001234567"
              inputMode="tel"
              {...form.register('phone')}
            />
            {form.formState.errors.phone && (
              <p role="alert" className="text-destructive text-xs">
                {form.formState.errors.phone.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="locale">{t('common.language')}</Label>
            <Select
              value={form.watch('locale') ?? 'en'}
              onValueChange={(value) => form.setValue('locale', value as 'en' | 'ar')}
            >
              <SelectTrigger id="locale">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCALES.map((locale) => (
                  <SelectItem key={locale} value={locale}>
                    {LOCALE_LABEL[locale]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="marketing"
              checked={form.watch('marketingOptIn') ?? false}
              onCheckedChange={(checked) => form.setValue('marketingOptIn', Boolean(checked))}
            />
            <Label htmlFor="marketing" className="cursor-pointer font-normal">
              {t('auth.marketingOptIn')}
            </Label>
          </div>

          <Button type="submit" loading={update.isPending}>
            {t('common.save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
