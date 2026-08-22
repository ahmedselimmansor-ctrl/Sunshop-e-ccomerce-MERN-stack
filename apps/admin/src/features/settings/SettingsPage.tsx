import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSettings, useUpdateSettings } from '@/lib/queries';

/**
 * Store settings.
 *
 * Maintenance mode is deliberately given its own visually loud section: it
 * takes the storefront offline for every customer, and it should never be a
 * checkbox someone flips while scrolling past.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('settings.title'));
  const { data: settings, isLoading } = useSettings();
  const update = useUpdateSettings();

  const [form, setForm] = useState({
    supportEmail: '',
    taxRatePercent: 0,
    taxIncludedInPrices: false,
    maintenanceMode: false,
  });

  useEffect(() => {
    if (!settings) return;
    setForm({
      supportEmail: settings.supportEmail,
      taxRatePercent: settings.taxRatePercent,
      taxIncludedInPrices: settings.taxIncludedInPrices,
      maintenanceMode: settings.maintenanceMode,
    });
  }, [settings]);

  if (isLoading) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-display text-2xl font-bold">{t('settings.title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle as="h2">{t('settings.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="supportEmail">{t('settings.supportEmail')}</Label>
            <Input
              id="supportEmail"
              type="email"
              dir="ltr"
              value={form.supportEmail}
              onChange={(event) => setForm({ ...form, supportEmail: event.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tax">{t('settings.tax')}</Label>
            <Input
              id="tax"
              type="number"
              min={0}
              max={100}
              step={0.5}
              className="numeric"
              value={form.taxRatePercent}
              onChange={(event) => setForm({ ...form, taxRatePercent: Number(event.target.value) })}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="taxIncluded" className="font-normal">
              {t('settings.taxIncluded')}
            </Label>
            <Switch
              id="taxIncluded"
              checked={form.taxIncludedInPrices}
              onCheckedChange={(checked) => setForm({ ...form, taxIncludedInPrices: checked })}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle as="h2" className="text-destructive">
            {t('settings.maintenance')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <p id="maintenance-hint" className="text-muted-foreground text-sm">
              {t('settings.maintenanceHint')}
            </p>
            {/* This switch takes the storefront offline, and unlike the one
                above it had no label at all — a screen reader announced it as
                bare "switch". The name comes from the card title; the hint
                beside it explains the consequence. */}
            <Switch
              aria-label={t('settings.maintenance')}
              aria-describedby="maintenance-hint"
              checked={form.maintenanceMode}
              onCheckedChange={(checked) => {
                if (checked && !window.confirm(t('settings.maintenanceHint'))) return;
                setForm({ ...form, maintenanceMode: checked });
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Button
        loading={update.isPending}
        onClick={() =>
          update.mutate(form, {
            onSuccess: () => toast.success(t('settings.saved')),
            onError: (error: Error) => toast.error(error.message),
          })
        }
      >
        {t('common.save')}
      </Button>
    </div>
  );
}
