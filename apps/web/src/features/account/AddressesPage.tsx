import { zodResolver } from '@hookform/resolvers/zod';
import { upsertAddressSchema, type SavedAddress } from '@sunshop/shared';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { EmptyState } from '@/components/common/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ApiClientError } from '@/lib/api';
import { useAddAddress, useDeleteAddress, useProfile, useUpdateAddress } from '@/lib/queries';

const EMPTY: SavedAddress = {
  fullName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'EG',
  notes: '',
  isDefaultShipping: false,
  isDefaultBilling: false,
};

export function AddressesPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('account.addresses'));
  const { data: profile, isLoading } = useProfile();
  const addAddress = useAddAddress();
  const updateAddress = useUpdateAddress();
  const deleteAddress = useDeleteAddress();

  const [editing, setEditing] = useState<SavedAddress | null>(null);
  const [open, setOpen] = useState(false);

  const form = useForm<SavedAddress>({
    resolver: zodResolver(upsertAddressSchema),
    defaultValues: EMPTY,
  });

  function openFor(address: SavedAddress | null) {
    setEditing(address);
    form.reset(address ?? EMPTY);
    setOpen(true);
  }

  async function onSubmit(values: SavedAddress) {
    try {
      if (editing?._id) {
        await updateAddress.mutateAsync({ id: editing._id, input: values });
      } else {
        await addAddress.mutateAsync(values);
      }
      toast.success(t('account.saved'));
      setOpen(false);
    } catch (error) {
      if (error instanceof ApiClientError) {
        for (const [path, message] of Object.entries(error.fieldErrors)) {
          form.setError(path as keyof SavedAddress, { message });
        }
        toast.error(error.message);
      } else {
        toast.error(t('errors.generic'));
      }
    }
  }

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const addresses = profile?.addresses ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">{t('account.addresses')}</h2>
        <Button size="sm" onClick={() => openFor(null)}>
          <Plus aria-hidden />
          {t('account.addAddress')}
        </Button>
      </div>

      {addresses.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title={t('account.addresses')}
          description={t('checkout.shippingAddress')}
          action={<Button onClick={() => openFor(null)}>{t('account.addAddress')}</Button>}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {addresses.map((address) => (
            <li key={address._id}>
              <Card>
                <CardContent className="space-y-1 p-4 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{address.fullName}</span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('common.edit')}
                        onClick={() => openFor(address)}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('common.delete')}
                        onClick={() => {
                          if (!address._id) return;
                          deleteAddress.mutate(address._id, {
                            onSuccess: () => toast.success(t('common.delete')),
                          });
                        }}
                      >
                        <Trash2 className="text-destructive size-3.5" aria-hidden />
                      </Button>
                    </div>
                  </div>

                  <p className="numeric text-muted-foreground" dir="ltr">
                    {address.phone}
                  </p>
                  <p className="text-muted-foreground">{address.line1}</p>
                  {address.line2 && <p className="text-muted-foreground">{address.line2}</p>}
                  <p className="text-muted-foreground">
                    {address.city}, {address.country}
                  </p>

                  <div className="flex flex-wrap gap-1 pt-1">
                    {address.isDefaultShipping && (
                      <Badge variant="secondary">{t('account.defaultShipping')}</Badge>
                    )}
                    {address.isDefaultBilling && (
                      <Badge variant="secondary">{t('account.defaultBilling')}</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t('common.edit') : t('account.addAddress')}</DialogTitle>
          </DialogHeader>

          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-3 sm:grid-cols-2"
            noValidate
          >
            <Field label={t('checkout.fullName')} error={form.formState.errors.fullName?.message}>
              <Input {...form.register('fullName')} autoComplete="name" />
            </Field>
            <Field label={t('checkout.phone')} error={form.formState.errors.phone?.message}>
              <Input {...form.register('phone')} dir="ltr" placeholder="+201001234567" />
            </Field>
            <Field
              label={t('checkout.line1')}
              error={form.formState.errors.line1?.message}
              className="sm:col-span-2"
            >
              <Input {...form.register('line1')} autoComplete="address-line1" />
            </Field>
            <Field label={t('checkout.line2')} className="sm:col-span-2">
              <Input {...form.register('line2')} autoComplete="address-line2" />
            </Field>
            <Field label={t('checkout.city')} error={form.formState.errors.city?.message}>
              <Input {...form.register('city')} autoComplete="address-level2" />
            </Field>
            <Field label={t('checkout.country')} error={form.formState.errors.country?.message}>
              <Input {...form.register('country')} maxLength={2} dir="ltr" className="uppercase" />
            </Field>

            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="defaultShipping"
                  checked={form.watch('isDefaultShipping')}
                  onCheckedChange={(checked) =>
                    form.setValue('isDefaultShipping', Boolean(checked))
                  }
                />
                <Label htmlFor="defaultShipping" className="cursor-pointer font-normal">
                  {t('account.defaultShipping')}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="defaultBilling"
                  checked={form.watch('isDefaultBilling')}
                  onCheckedChange={(checked) => form.setValue('isDefaultBilling', Boolean(checked))}
                />
                <Label htmlFor="defaultBilling" className="cursor-pointer font-normal">
                  {t('account.defaultBilling')}
                </Label>
              </div>
            </div>

            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={addAddress.isPending || updateAddress.isPending}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
      {error && (
        <p role="alert" className="text-destructive mt-1 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
