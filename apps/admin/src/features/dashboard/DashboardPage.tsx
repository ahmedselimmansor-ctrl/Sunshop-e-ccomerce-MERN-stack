import { ArrowDownRight, ArrowUpRight, PackageX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { localized, useFormat } from '@/lib/format';
import { useDashboard } from '@/lib/queries';
import { cn } from '@/lib/utils';

type Preset = '7d' | '30d' | '90d' | '12m';

/**
 * Operations overview.
 *
 * Every KPI shows its delta against the immediately preceding window of the
 * same length. An absolute number alone ("$41,000") tells an operator nothing;
 * the direction of travel is the whole point of a dashboard.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('dashboard.title'));
  const format = useFormat();
  const [preset, setPreset] = useState<Preset>('30d');
  const { data, isLoading } = useDashboard(preset);

  const kpis = data
    ? [
        {
          label: t('dashboard.revenue'),
          value: format.money(data.kpi.revenue),
          delta: data.kpi.deltas.revenue,
        },
        {
          label: t('dashboard.orders'),
          value: format.number(data.kpi.orders),
          delta: data.kpi.deltas.orders,
        },
        {
          label: t('dashboard.aov'),
          value: format.money(data.kpi.averageOrderValue),
          delta: data.kpi.deltas.averageOrderValue,
        },
        {
          label: t('dashboard.newCustomers'),
          value: format.number(data.kpi.newCustomers),
          delta: data.kpi.deltas.customers,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">{t('dashboard.title')}</h1>

        {/* The four ranges need ~430px and the triggers are whitespace-nowrap,
            so on a phone this segmented control pushed the whole page sideways.
            It scrolls on its own now; -mx-1/px-1 keeps the focus ring from
            being clipped at the ends. */}
        <Tabs
          value={preset}
          onValueChange={(value) => setPreset(value as Preset)}
          className="-mx-1 max-w-full overflow-x-auto px-1"
        >
          <TabsList>
            <TabsTrigger value="7d">{t('dashboard.range7d')}</TabsTrigger>
            <TabsTrigger value="30d">{t('dashboard.range30d')}</TabsTrigger>
            <TabsTrigger value="90d">{t('dashboard.range90d')}</TabsTrigger>
            <TabsTrigger value="12m">{t('dashboard.range12m')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28" />)
          : kpis.map((kpi) => (
              <Card key={kpi.label}>
                <CardContent className="p-5">
                  <p className="text-muted-foreground text-sm">{kpi.label}</p>
                  <p className="numeric mt-1 text-2xl font-bold">{kpi.value}</p>
                  <p
                    className={cn(
                      'mt-1 flex items-center gap-1 text-xs font-medium',
                      kpi.delta >= 0 ? 'text-success' : 'text-destructive',
                    )}
                  >
                    {kpi.delta >= 0 ? (
                      <ArrowUpRight className="size-3.5" aria-hidden />
                    ) : (
                      <ArrowDownRight className="size-3.5" aria-hidden />
                    )}
                    <span className="numeric">{Math.abs(kpi.delta)}%</span>
                    <span className="text-muted-foreground">{t('dashboard.vsPrevious')}</span>
                  </p>
                </CardContent>
              </Card>
            ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle as="h2">{t('dashboard.revenueOverTime')}</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {isLoading ? (
              <Skeleton className="size-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data?.timeseries ?? []}
                  margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
                >
                  <defs>
                    <linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="t"
                    tick={{ fontSize: 11 }}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="hsl(var(--muted-foreground))"
                    // Values are minor units; show major units on the axis.
                    tickFormatter={(value: number) => String(Math.round(value / 100))}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value: number) => [
                      format.money({ amount: value, currency: (data?.currency ?? 'USD') as never }),
                      t('dashboard.revenue'),
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#revenue)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t('dashboard.topProducts')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.topProducts ?? []).slice(0, 6).map((product) => (
              <div key={product.id} className="flex items-center gap-3">
                <div className="bg-muted size-9 shrink-0 overflow-hidden rounded">
                  {product.imageUrl && (
                    <img
                      src={product.imageUrl}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {localized(product.name, format.locale)}
                  </p>
                  <p className="numeric text-muted-foreground text-xs">
                    {product.unitsSold} {t('dashboard.unitsSold')}
                  </p>
                </div>
                <span className="numeric text-sm font-semibold">
                  {format.money(product.revenue)}
                </span>
              </div>
            ))}
            {!isLoading && (data?.topProducts.length ?? 0) === 0 && (
              <p className="text-muted-foreground text-sm">{t('common.noResults')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <PackageX className="text-warning size-4" aria-hidden />
              {t('dashboard.lowStock')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {(data?.lowStock ?? []).slice(0, 8).map((entry) => (
                <li key={entry.variantId} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {localized(entry.name, format.locale)}
                  </span>
                  <code className="numeric text-muted-foreground text-xs">{entry.sku}</code>
                  <Badge
                    variant={entry.stock === 0 ? 'destructive' : 'warning'}
                    className="numeric"
                  >
                    {entry.stock}
                  </Badge>
                </li>
              ))}
            </ul>
            {!isLoading && (data?.lowStock.length ?? 0) === 0 && (
              <p className="text-muted-foreground text-sm">{t('common.noResults')}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t('dashboard.recentOrders')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {(data?.recentOrders ?? []).map((order) => (
                <li key={order.id} className="flex items-center gap-3 py-2">
                  <Link
                    to={`/orders/${order.id}`}
                    className="numeric font-mono text-sm hover:underline"
                  >
                    {order.orderNumber}
                  </Link>
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                    {order.customer}
                  </span>
                  <span className="numeric text-sm font-semibold">{format.money(order.total)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
