import { money, type AnalyticsRange, type Currency, type Dashboard } from '@sunshop/shared';

import { env } from '../../config/env';
import { Order } from '../../models/Order';
import { User } from '../../models/User';
import { cached, queryHash } from '../../services/cache';
import { publicUrlFor } from '../../services/storage';
import { getLowStock } from '../products/product.service';

/**
 * Dashboard analytics.
 *
 * Everything here is an aggregation over the orders collection, cached for a
 * few minutes. Two deliberate choices:
 *
 *  • **Only paid orders count as revenue.** Including `pending_payment` would
 *    make the dashboard read high and then silently correct itself when
 *    reservations expire, which destroys trust in the number.
 *  • **Refunds are subtracted, not hidden.** A merchant needs net revenue.
 */

interface ResolvedRange {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  granularity: 'hour' | 'day' | 'week' | 'month';
}

function resolveRange(input: AnalyticsRange): ResolvedRange {
  const to = input.to ?? new Date();
  let from = input.from;

  if (!from) {
    const days: Record<string, number> = { today: 1, '7d': 7, '30d': 30, '90d': 90, '12m': 365 };
    from = new Date(to.getTime() - (days[input.preset] ?? 30) * 86_400_000);
  }

  const span = to.getTime() - from.getTime();
  return {
    from,
    to,
    // The comparison window is the same length, immediately before.
    previousFrom: new Date(from.getTime() - span),
    previousTo: from,
    granularity: input.granularity,
  };
}

function dateFormat(granularity: ResolvedRange['granularity']): string {
  switch (granularity) {
    case 'hour':
      return '%Y-%m-%dT%H:00';
    case 'week':
      return '%Y-W%V';
    case 'month':
      return '%Y-%m';
    case 'day':
    default:
      return '%Y-%m-%d';
  }
}

const PAID_STATUSES = ['paid', 'partially_refunded'];

export async function getDashboard(input: AnalyticsRange): Promise<Dashboard> {
  const range = resolveRange(input);
  const currency = env.DEFAULT_CURRENCY as Currency;

  return cached(
    `analytics:dashboard:${queryHash(input)}`,
    async () => {
      const [
        current,
        previous,
        timeseries,
        topProducts,
        topCategories,
        lowStock,
        recentOrders,
        byStatus,
        customers,
      ] = await Promise.all([
        aggregateWindow(range.from, range.to),
        aggregateWindow(range.previousFrom, range.previousTo),
        aggregateTimeseries(range),
        aggregateTopProducts(range.from, range.to),
        aggregateTopCategories(range.from, range.to),
        getLowStock(),
        fetchRecentOrders(),
        aggregateOrdersByStatus(),
        countCustomers(range),
      ]);

      const delta = (now: number, before: number) =>
        before === 0 ? (now > 0 ? 100 : 0) : Number((((now - before) / before) * 100).toFixed(1));

      const averageOrderValue =
        current.orders > 0 ? Math.round(current.revenue / current.orders) : 0;
      const previousAov = previous.orders > 0 ? Math.round(previous.revenue / previous.orders) : 0;

      return {
        currency,
        kpi: {
          revenue: money(current.revenue - current.refunds, currency),
          orders: current.orders,
          averageOrderValue: money(averageOrderValue, currency),
          customers: customers.total,
          newCustomers: customers.new,
          conversionRate: 0,
          refunds: money(current.refunds, currency),
          deltas: {
            revenue: delta(current.revenue - current.refunds, previous.revenue - previous.refunds),
            orders: delta(current.orders, previous.orders),
            averageOrderValue: delta(averageOrderValue, previousAov),
            customers: delta(customers.new, customers.previousNew),
          },
        },
        timeseries,
        topProducts: topProducts.map((entry) => ({
          id: String(entry._id),
          name: entry.name,
          imageUrl: publicUrlFor(entry.imageKey),
          unitsSold: entry.unitsSold,
          revenue: money(entry.revenue, currency),
        })),
        topCategories: topCategories.map((entry) => ({
          id: String(entry._id),
          name: entry.name,
          revenue: money(entry.revenue, currency),
        })),
        lowStock: lowStock.slice(0, 20).map((entry) => ({
          productId: entry.productId,
          variantId: entry.variantId,
          sku: entry.sku,
          name: entry.name as { en: string; ar: string },
          stock: entry.stock,
          threshold: entry.threshold,
        })),
        recentOrders,
        ordersByStatus: byStatus,
      } satisfies Dashboard;
    },
    { ttl: 180 },
  );
}

async function aggregateWindow(from: Date, to: Date) {
  const [row] = await Order.aggregate<{ revenue: number; orders: number; refunds: number }>([
    { $match: { paymentStatus: { $in: PAID_STATUSES }, paidAt: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: null,
        revenue: { $sum: '$totals.total.amount' },
        orders: { $sum: 1 },
        refunds: { $sum: { $ifNull: ['$refundedAmount.amount', 0] } },
      },
    },
  ]);

  return row ?? { revenue: 0, orders: 0, refunds: 0 };
}

async function aggregateTimeseries(range: ResolvedRange) {
  const rows = await Order.aggregate<{ _id: string; revenue: number; orders: number }>([
    {
      $match: {
        paymentStatus: { $in: PAID_STATUSES },
        paidAt: { $gte: range.from, $lte: range.to },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: dateFormat(range.granularity), date: '$paidAt' } },
        revenue: { $sum: '$totals.total.amount' },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((row) => ({ t: row._id, revenue: row.revenue, orders: row.orders }));
}

async function aggregateTopProducts(from: Date, to: Date) {
  return Order.aggregate<{
    _id: unknown;
    name: { en: string; ar: string };
    imageKey: string | null;
    unitsSold: number;
    revenue: number;
  }>([
    { $match: { paymentStatus: { $in: PAID_STATUSES }, paidAt: { $gte: from, $lte: to } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        name: { $first: '$items.name' },
        imageKey: { $first: '$items.imageKey' },
        unitsSold: { $sum: '$items.quantity' },
        revenue: { $sum: '$items.lineTotal.amount' },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: 10 },
  ]);
}

async function aggregateTopCategories(from: Date, to: Date) {
  return Order.aggregate<{ _id: unknown; name: { en: string; ar: string }; revenue: number }>([
    { $match: { paymentStatus: { $in: PAID_STATUSES }, paidAt: { $gte: from, $lte: to } } },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'product',
        pipeline: [{ $project: { categories: 1 } }],
      },
    },
    { $unwind: '$product' },
    { $unwind: '$product.categories' },
    {
      $group: {
        _id: '$product.categories',
        revenue: { $sum: '$items.lineTotal.amount' },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: 8 },
    {
      $lookup: {
        from: 'categories',
        localField: '_id',
        foreignField: '_id',
        as: 'category',
        pipeline: [{ $project: { name: 1 } }],
      },
    },
    { $unwind: '$category' },
    { $project: { _id: 1, revenue: 1, name: '$category.name' } },
  ]);
}

async function fetchRecentOrders() {
  const orders = await Order.find({})
    .sort({ placedAt: -1 })
    .limit(8)
    .select('orderNumber email totals status placedAt shippingAddress.fullName')
    .lean();

  return orders.map((order) => ({
    id: String(order._id),
    orderNumber: order.orderNumber,
    customer: order.shippingAddress?.fullName ?? order.email,
    total: order.totals.total,
    status: order.status,
    placedAt: new Date(order.placedAt).toISOString(),
  }));
}

async function aggregateOrdersByStatus() {
  const rows = await Order.aggregate<{ _id: string; count: number }>([
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  return rows.map((row) => ({ status: row._id, count: row.count }));
}

async function countCustomers(range: ResolvedRange) {
  const [total, fresh, previousNew] = await Promise.all([
    User.countDocuments({ roles: 'customer', deletedAt: null }),
    User.countDocuments({
      roles: 'customer',
      deletedAt: null,
      createdAt: { $gte: range.from, $lte: range.to },
    }),
    User.countDocuments({
      roles: 'customer',
      deletedAt: null,
      createdAt: { $gte: range.previousFrom, $lte: range.previousTo },
    }),
  ]);

  return { total, new: fresh, previousNew };
}

/** CSV export for finance. Streams would be better past ~50k rows. */
export async function exportOrdersCsv(from: Date, to: Date): Promise<string> {
  const orders = await Order.find({ placedAt: { $gte: from, $lte: to } })
    .sort({ placedAt: 1 })
    .lean();

  const header = [
    'order_number',
    'placed_at',
    'status',
    'payment_status',
    'email',
    'currency',
    'subtotal',
    'discount',
    'shipping',
    'tax',
    'total',
    'refunded',
    'country',
  ].join(',');

  const rows = orders.map((order) =>
    [
      order.orderNumber,
      new Date(order.placedAt).toISOString(),
      order.status,
      order.paymentStatus,
      // Quote the email: it cannot contain a comma, but the habit is cheap.
      `"${order.email}"`,
      order.currency,
      order.totals.subtotal.amount / 100,
      order.totals.discount.amount / 100,
      order.totals.shipping.amount / 100,
      order.totals.tax.amount / 100,
      order.totals.total.amount / 100,
      (order.refundedAmount?.amount ?? 0) / 100,
      order.shippingAddress?.country ?? '',
    ].join(','),
  );

  return [header, ...rows].join('\n');
}
