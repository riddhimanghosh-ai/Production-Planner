import { store } from "@/data/store";
import type { Order, OrderLine } from "@/data/types";
import { PRODUCT_TYPES } from "./domain";
import { computeMargin, type MarginResult } from "./margin";
import type { Settings } from "./settings";
import { withShare } from "./workflow";

// Margin of one order line at today's costs.
export function lineMarginFor(ol: OrderLine, order: Order, s: Settings): MarginResult | null {
  const sku = store().skus.find((x) => x.id === ol.skuId);
  if (!sku) return null;
  return computeMargin(
    {
      sku: withShare(sku, ol.chicoryPct),
      quantityMt: ol.quantityMt,
      pricePerKg: ol.pricePerKg,
      currency: order.currency,
      beanOrigin: order.beanOrigin,
      gbGrade: order.gbGrade,
      gbClosedPrice: order.gbPriceClosed ? order.gbClosedPrice : null,
      freightBasis: order.freightBasis,
      advancePct: order.advancePct,
      creditDays: order.creditDays,
    },
    s,
  );
}

// Indicative prices for a product with no orders yet (₹ per kg, bulk).
export const TYPICAL_INR_PER_KG: Record<string, number> = { SD: 1450, AG: 1580, FDC: 2460 };

// Average profit per kg for each product, weighted by tonnes, across approved and waiting orders.
// Used to put a rupee value on line capacity. Falls back to a typical bulk order when a product has none.
export function avgMarginPerKgByProduct(s: Settings): Record<string, { perKg: number; pct: number; fromOrders: boolean }> {
  const st = store();
  const live = new Set(st.orders.filter((o) => ["COMMITTED", "PENDING_APPROVAL"].includes(o.status)).map((o) => o.id));
  const acc: Record<string, { margin: number; revenue: number; qty: number }> = {};
  for (const ol of st.orderLines) {
    if (!live.has(ol.orderId)) continue;
    const order = st.orders.find((o) => o.id === ol.orderId)!;
    const sku = st.skus.find((x) => x.id === ol.skuId);
    const m = lineMarginFor(ol, order, s);
    if (!sku || !m) continue;
    const a = (acc[sku.productType] ??= { margin: 0, revenue: 0, qty: 0 });
    a.margin += m.totalMargin;
    a.revenue += m.revenue;
    a.qty += ol.quantityMt;
  }
  const out: Record<string, { perKg: number; pct: number; fromOrders: boolean }> = {};
  for (const pt of Object.keys(PRODUCT_TYPES)) {
    const a = acc[pt];
    if (a && a.qty > 0) out[pt] = { perKg: a.margin / (a.qty * 1000), pct: a.revenue ? (a.margin / a.revenue) * 100 : 0, fromOrders: true };
    else {
      const m = computeMargin(
        {
          sku: { productType: pt, blend: "PURE", packFormat: "BULK", coffeeShare: 1 },
          quantityMt: 1,
          pricePerKg: TYPICAL_INR_PER_KG[pt] ?? 1450,
          currency: "INR",
          beanOrigin: "VIETNAM",
          gbClosedPrice: null,
          freightBasis: "BUYER",
          advancePct: 0,
          creditDays: 30,
        },
        s,
      );
      out[pt] = { perKg: m.marginPerKg, pct: m.marginPct, fromOrders: false };
    }
  }
  return out;
}
