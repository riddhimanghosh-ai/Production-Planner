import { store } from "@/data/store";
import { loadCapacityState, LOADING_STATUSES, planHorizon, productLoadAt } from "./capacity";
import { productLabel, PRODUCT_TYPES } from "./domain";
import { avgMarginPerKgByProduct, lineMarginFor } from "./order-margin";
import { planSuggestions } from "./recommend";
import { loadSettings } from "./settings";

// Everything the What-if playground needs, precomputed so the sliders update instantly in the browser.
// The playground itself re-checks fit and re-prices margins client-side; nothing is saved.
export type PlannedOrder = { orderId: number; ref: string; customer: string; product: string; qty: number; status: string; revenue: number };
export type PlaygroundData = {
  lines: { id: number; code: string; productTypes: string[] }[];
  months: string[];
  // Line setup today: tonnes a month per line and product.
  caps: Record<string, Record<string, number>>;
  // Planned orders per line, product and month (key `${lineId}|${pt}|${month}`), and the total load per cell.
  orders: Record<string, PlannedOrder[]>;
  load: Record<string, number>;
  perKg: Record<string, { perKg: number; fromOrders: boolean }>;
  waiting: { ref: string; customer: string; product: string; productType: string; slotMt: number; month: string }[];
  bean: { target: number; rows: { key: string; orderId: number; ref: string; customer: string; product: string; qty: number; fixed: boolean; priceKg: number; costKg: number; beanKg: number }[] };
};

export function playgroundData(): PlaygroundData {
  const st = store();
  const s = loadSettings();
  const state = loadCapacityState();
  const months = planHorizon(12);
  const pts = Object.keys(PRODUCT_TYPES);
  const lines = state.lines.map((l) => ({ id: l.id, code: l.code, productTypes: l.productTypes }));

  const caps: Record<string, Record<string, number>> = {};
  const orders: Record<string, PlannedOrder[]> = {};
  const load: Record<string, number> = {};
  for (const l of state.lines) {
    caps[l.id] = Object.fromEntries(pts.map((pt) => [pt, l.productTypes.includes(pt) ? Math.round(l.productCaps[pt] ?? 0) : 0]));
    for (const pt of pts)
      for (const m of months) {
        const k = `${l.id}|${pt}|${m}`;
        load[k] = productLoadAt(state, l.id, pt, m);
        orders[k] = state.rows
          .filter((r) => r.lineId === l.id && r.month === m && r.productType === pt)
          .map((r) => {
            const ol = st.orderLines.find((x) => x.id === r.orderLineId)!;
            const o = st.orders.find((x) => x.id === r.orderId)!;
            const sku = st.skus.find((x) => x.id === ol.skuId)!;
            return { orderId: r.orderId, ref: r.orderRef, customer: r.customer, product: productLabel(sku, ol.chicoryPct), qty: r.quantityMt, status: r.status, revenue: lineMarginFor(ol, o, s)?.revenue ?? 0 };
          });
      }
  }

  const perKg = Object.fromEntries(Object.entries(avgMarginPerKgByProduct(s)).map(([k, v]) => [k, { perKg: v.perKg, fromOrders: v.fromOrders }]));
  const waiting = planSuggestions()
    .filter((x) => !x.keep)
    .map((x) => ({ ref: x.ref, customer: x.customer, product: x.product, productType: x.productType, slotMt: x.slotMt, month: x.deliveryMonth }));

  // Bean cost per kg of product, so the browser can re-price margins for any % move.
  const rows = st.orders
    .filter((o) => LOADING_STATUSES.includes(o.status))
    .flatMap((o) =>
      st.orderLines
        .filter((l) => l.orderId === o.id)
        .map((ol) => {
          const sku = st.skus.find((x) => x.id === ol.skuId)!;
          const m = lineMarginFor(ol, o, s)!;
          return {
            key: `${o.id}-${ol.id}`,
            orderId: o.id,
            ref: o.ref,
            customer: st.customers.find((c) => c.id === o.customerId)?.name ?? "",
            product: productLabel(sku, ol.chicoryPct),
            qty: ol.quantityMt,
            fixed: o.gbPriceClosed,
            priceKg: m.priceInrPerKg,
            costKg: m.costPerKg,
            beanKg: (m.greenBeanKg * m.beanPricePerKg) / (ol.quantityMt * 1000),
          };
        }),
    );

  return { lines, months, caps, orders, load, perKg, waiting, bean: { target: s["margin.target_pct"], rows } };
}
