import { store } from "@/data/store";
import { capacityAt, freeAt, loadCapacityState, LOADING_STATUSES, planHorizon, productFreeAt } from "./capacity";
import { addMonths, monthLabel, productLabel } from "./domain";
import { avgMarginPerKgByProduct, lineMarginFor } from "./order-margin";
import { planSuggestions } from "./recommend";
import { loadSettings } from "./settings";

// "What if" scenarios. They only read the plan and never change it.

// 1. A line stops for a month: where can its orders go?
export type LineStopRow = { orderId: number; ref: string; customer: string; product: string; qty: number; status: string; outcome: "move" | "late" | "partial" | "risk"; to: string; riskMt: number; revenue: number | null };
export type LineStopResult = { line: string; month: string; capacityLost: number; freeLost: number; rows: LineStopRow[]; affectedMt: number; movedMt: number; lateMt: number; riskMt: number; revenueAtRisk: number };

export function simulateLineStop(lineId: number, month: string): LineStopResult | null {
  const st = store();
  const s = loadSettings();
  const state = loadCapacityState();
  const line = state.lines.find((l) => l.id === lineId);
  if (!line) return null;
  // Room already given to an earlier order in this run, so two orders never take the same space.
  const claimed = new Map<string, number>();
  const freeFor = (lid: number, pt: string, m: string) => productFreeAt(state, lid, pt, m) - (claimed.get(`${lid}|${m}|${pt}`) ?? 0);
  const claim = (lid: number, pt: string, m: string, qty: number) => claimed.set(`${lid}|${m}|${pt}`, (claimed.get(`${lid}|${m}|${pt}`) ?? 0) + qty);

  const affected = state.rows.filter((r) => r.lineId === lineId && r.month === month).sort((a, b) => Number(b.status === "COMMITTED") - Number(a.status === "COMMITTED") || b.quantityMt - a.quantityMt);
  const rows: LineStopRow[] = affected.map((r) => {
    const ol = st.orderLines.find((l) => l.id === r.orderLineId)!;
    const order = st.orders.find((o) => o.id === r.orderId)!;
    const sku = st.skus.find((x) => x.id === ol.skuId)!;
    const base = { orderId: r.orderId, ref: r.orderRef, customer: r.customer, product: productLabel(sku, ol.chicoryPct), qty: r.quantityMt, status: r.status, revenue: lineMarginFor(ol, order, s)?.revenue ?? null };
    const others = state.lines.filter((l) => l.id !== lineId && l.productTypes.includes(r.productType));
    const fit = (cands: typeof state.lines, m: string) =>
      cands
        .map((l) => ({ l, free: freeFor(l.id, r.productType, m) }))
        .filter((x) => x.free >= r.quantityMt - 0.05)
        .sort((a, b) => b.free - a.free)[0];
    const same = fit(others, month);
    if (same) {
      claim(same.l.id, r.productType, month, r.quantityMt);
      return { ...base, outcome: "move", to: `${same.l.code}, ${monthLabel(month)}`, riskMt: 0 };
    }
    const next = addMonths(month, 1);
    const later = fit(
      state.lines.filter((l) => l.productTypes.includes(r.productType)),
      next,
    );
    if (later) {
      claim(later.l.id, r.productType, next, r.quantityMt);
      return { ...base, outcome: "late", to: `${later.l.code}, ${monthLabel(next)} (a month late)`, riskMt: 0 };
    }
    const best = others.map((l) => ({ l, free: freeFor(l.id, r.productType, month) })).sort((a, b) => b.free - a.free)[0];
    if (best && best.free > 0.5) {
      claim(best.l.id, r.productType, month, best.free);
      return { ...base, outcome: "partial", to: `${best.free.toFixed(1)} t to ${best.l.code}, the rest has no room`, riskMt: r.quantityMt - best.free };
    }
    return { ...base, outcome: "risk", to: "No room on any line", riskMt: r.quantityMt };
  });
  const sum = (f: (r: LineStopRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    line: line.code,
    month,
    capacityLost: capacityAt(state, lineId, month),
    freeLost: Math.max(0, freeAt(state, lineId, month)),
    rows,
    affectedMt: sum((r) => r.qty),
    movedMt: sum((r) => (r.outcome === "move" ? r.qty : 0)),
    lateMt: sum((r) => (r.outcome === "late" ? r.qty : 0)),
    riskMt: sum((r) => r.riskMt),
    revenueAtRisk: sum((r) => (r.revenue ?? 0) * (r.riskMt / r.qty)),
  };
}

// 2. Green bean price moves: which open orders lose their margin?
export type BeanRow = { key: string; orderId: number; ref: string; customer: string; product: string; qty: number; status: string; fixed: boolean; now: number; after: number; profitNow: number; profitAfter: number; belowAfter: boolean };
export type BeanResult = { pct: number; target: number; rows: BeanRow[]; exposed: number; fixedCount: number; profitNow: number; profitAfter: number; belowNow: number; belowAfter: number };

export function simulateBeanPrice(pct: number): BeanResult {
  const st = store();
  const s = loadSettings();
  const s2 = { ...s };
  for (const k of Object.keys(s2)) if (k.startsWith("bean_price.")) s2[k] = Math.round(s[k] * (1 + pct / 100));
  const target = s["margin.target_pct"];
  const rows: BeanRow[] = st.orders
    .filter((o) => LOADING_STATUSES.includes(o.status))
    .flatMap((o) =>
      st.orderLines
        .filter((l) => l.orderId === o.id)
        .map((ol) => {
          const sku = st.skus.find((x) => x.id === ol.skuId)!;
          const now = lineMarginFor(ol, o, s)!;
          const after = lineMarginFor(ol, o, s2)!;
          return {
            key: `${o.id}-${ol.id}`,
            orderId: o.id,
            ref: o.ref,
            customer: st.customers.find((c) => c.id === o.customerId)?.name ?? "",
            product: productLabel(sku, ol.chicoryPct),
            qty: ol.quantityMt,
            status: o.status,
            fixed: o.gbPriceClosed,
            now: now.marginPct,
            after: after.marginPct,
            profitNow: now.totalMargin,
            profitAfter: after.totalMargin,
            belowAfter: after.marginPct < target,
          };
        }),
    )
    .sort((a, b) => a.after - b.after);
  return {
    pct,
    target,
    rows,
    exposed: rows.filter((r) => !r.fixed).length,
    fixedCount: rows.filter((r) => r.fixed).length,
    profitNow: rows.reduce((a, r) => a + r.profitNow, 0),
    profitAfter: rows.reduce((a, r) => a + r.profitAfter, 0),
    belowNow: rows.filter((r) => r.now < target).length,
    belowAfter: rows.filter((r) => r.belowAfter).length,
  };
}

// 3. More capacity on a line: what does the extra room earn, and which waiting orders fit?
export type CapacityResult = {
  line: string;
  productType: string;
  extraMt: number;
  makesToday: boolean;
  months: { month: string; freeNow: number; freeAfter: number }[];
  profitPerMonth: number;
  marginPerKg: number;
  fromOrders: boolean;
  placeable: { ref: string; customer: string; product: string; slotMt: number; month: string }[];
};

export function simulateCapacity(lineId: number, productType: string, extraMt: number): CapacityResult | null {
  const s = loadSettings();
  const state = loadCapacityState();
  const line = state.lines.find((l) => l.id === lineId);
  if (!line) return null;
  const makesToday = line.productTypes.includes(productType);
  const months = planHorizon(12).map((m) => {
    const freeNow = makesToday ? Math.max(0, productFreeAt(state, lineId, productType, m)) : 0;
    return { month: m, freeNow, freeAfter: freeNow + extraMt };
  });
  const margin = avgMarginPerKgByProduct(s)[productType];
  const placeable = planSuggestions()
    .filter((x) => !x.keep && x.productType === productType)
    .filter((x) => {
      const cell = months.find((m) => m.month === x.deliveryMonth);
      return cell ? x.slotMt <= cell.freeAfter + 0.05 && x.slotMt > cell.freeNow + 0.05 : false;
    })
    .map((x) => ({ ref: x.ref, customer: x.customer, product: x.product, slotMt: x.slotMt, month: x.deliveryMonth }));
  return { line: line.code, productType, extraMt, makesToday, months, profitPerMonth: extraMt * 1000 * margin.perKg, marginPerKg: margin.perKg, fromOrders: margin.fromOrders, placeable };
}
