import { store } from "@/data/store";
import { beanPrice, monthLabel, monthStartDate, ORIGINS, PRODUCT_TYPES, shipmentTonnes, type Origin, type ProductType } from "./domain";
import { shortages, type Shortage } from "./inventory";
import type { Order, OrderLine } from "@/data/types";
import { freeAt, loadCapacityState } from "./capacity";
import type { MarginResult } from "./margin";
import { lineMarginFor } from "./order-margin";
import { loadSettings } from "./settings";
import { planAvailability } from "./workflow";

// The COO's question: can we make this order on time?
// 1. Line space: in each ship month, is there room on lines that make this product (ignoring this order's own booking)?
// 2. Materials: is it covered by stock + purchases on the way, and if not, can a purchase still arrive in time given the lead time?
export type Feasibility = {
  verdict: "ok" | "buy" | "no";
  headline: string;
  product: string;
  line: { ok: boolean; short: { month: string; short: number }[] };
  materials: { name: string; unit: string; month: string; short: number; orderBy: Date; earliest: string; canArrive: boolean; late: boolean; leadDays: number }[];
  // Detail for the COO check tab.
  // Green bean cost: the price the order was costed on vs today's market, and what that does to the margin.
  bean: {
    origin: string;
    grade: string;
    fixed: boolean;
    pricedAt: number;
    marketNow: number;
    changePct: number;
    beanTonnes: number;
    shareOfCost: number;
    marginThen: number | null;
    marginToday: number;
    minPct: number;
    risk: "low" | "watch" | "high";
    note: string;
    // Every input cost per kg of product: when the order was priced vs today.
    costs: { label: string; then: number | null; now: number; share: number }[];
  } | null;
  perMonth: { month: string; need: number; lines: { code: string; free: number; freeTotal: number; take: number }[]; short: number; fitsWithMix: boolean }[];
  suggestion: string | null;
};

export function orderFeasibility(orderId: number, shorts: Shortage[] = shortages(), today = new Date()): Feasibility | null {
  const st = store();
  const order = st.orders.find((o) => o.id === orderId);
  if (!order) return null;
  const lines = st.orderLines.filter((l) => l.orderId === orderId);
  const sku = st.skus.find((x) => x.id === lines[0]?.skuId);
  if (!sku || !lines.length) return null;

  const needs = order.shipments?.length ? shipmentTonnes(order.shipments) : lines.reduce<Record<string, number>>((a, l) => ({ ...a, [l.month]: (a[l.month] ?? 0) + l.quantityMt }), {});
  const months = Object.keys(needs).sort();
  const avail = planAvailability(sku.productType, months, needs, orderId, sku.blend);
  const lineShort = avail.perMonth.filter((m) => m.short > 0.05).map((m) => ({ month: m.month, short: m.short }));
  // Would it fit if the line's product split were changed (whole line free, not just this product's share)?
  const state = loadCapacityState({ excludeOrderId: orderId });
  const perMonth = avail.perMonth.map((m) => {
    const lines = m.lines.map((l) => ({ code: l.code, free: l.free, freeTotal: Math.max(0, freeAt(state, l.lineId, m.month)), take: m.proposal.find((p) => p.lineId === l.lineId)?.quantityMt ?? 0 }));
    return { month: m.month, need: m.need, lines, short: m.short, fitsWithMix: m.short > 0.05 && lines.reduce((a, l) => a + l.freeTotal, 0) >= m.need - 0.05 };
  });

  const materials = shorts
    .filter((x) => x.orders.some((o) => o.orderId === orderId))
    .map((x) => {
      const orderBy = new Date(monthStartDate(x.month).getTime() - x.leadDays * 86400000);
      const canArrive = x.earliestArrival <= x.month;
      return { name: x.name.replace("Green beans · ", "Beans · "), unit: x.unit, month: x.month, short: x.short, orderBy, earliest: x.earliestArrival, canArrive, late: canArrive && orderBy < today, leadDays: x.leadDays };
    });

  const blocked = materials.filter((m) => !m.canArrive);
  const verdict: Feasibility["verdict"] = lineShort.length || blocked.length ? "no" : materials.length ? "buy" : "ok";
  const firstBuy = [...materials].sort((a, b) => a.orderBy.getTime() - b.orderBy.getTime())[0];
  const headline =
    verdict === "ok"
      ? "Feasible: line space and materials are in place"
      : verdict === "buy"
        ? firstBuy.late
          ? "Feasible if we buy now (tight on lead time)"
          : `Feasible if we buy by ${firstBuy.orderBy.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
        : lineShort.length
          ? `Not feasible: no line space in ${lineShort.map((m) => monthLabel(m.month)).join(", ")}`
          : `Not feasible: ${blocked[0].name} can't arrive before ${monthLabel(blocked[0].earliest)}`;
  return { verdict, headline, product: PRODUCT_TYPES[sku.productType as ProductType] ?? sku.productType, line: { ok: !lineShort.length, short: lineShort }, materials, perMonth, suggestion: avail.suggestion, bean: beanCheck(order, lines) };
}

function beanCheck(order: Order, lines: OrderLine[]): Feasibility["bean"] {
  const s = loadSettings();
  const today = lines.map((l) => lineMarginFor(l, order, s)).filter((m): m is MarginResult => !!m);
  if (!today.length) return null;
  const revenue = today.reduce((a, m) => a + m.revenue, 0);
  const margin = today.reduce((a, m) => a + m.totalMargin, 0);
  const cost = today.reduce((a, m) => a + m.totalCost, 0);
  const beanCost = today.reduce((a, m) => a + (m.lines[0]?.perKg ?? 0) * (m.revenue / Math.max(1, m.priceInrPerKg)), 0);
  const snap = order.marginSnapshot as { marginPct?: number; byLine?: Record<number, { beanPricePerKg?: number }> } | null;
  const marketNow = beanPrice(s, order.beanOrigin, order.gbGrade);
  const pricedAt = order.gbPriceClosed && order.gbClosedPrice ? order.gbClosedPrice : (Object.values(snap?.byLine ?? {})[0]?.beanPricePerKg ?? marketNow);
  const marginToday = revenue ? (margin / revenue) * 100 : 0;
  const minPct = s["margin.target_pct"];
  const changePct = pricedAt ? ((marketNow - pricedAt) / pricedAt) * 100 : 0;
  const fixed = order.gbPriceClosed;
  const risk: "low" | "watch" | "high" = marginToday < minPct ? "high" : !fixed ? "watch" : "low";
  const note = fixed
    ? `Bean price fixed with the supplier at ₹${pricedAt}/kg, so market moves don't hit this order.`
    : `Not fixed: every ₹10/kg rise in ${ORIGINS[order.beanOrigin as Origin] ?? order.beanOrigin} beans costs about ₹${Math.round(today.reduce((a, m) => a + m.greenBeanKg, 0) * 10).toLocaleString("en-IN")}.`;
  // Tonnes-weighted per-kg cost by item, today and in the snapshot taken when the order was sent.
  const kgOf = (m: MarginResult) => m.revenue / Math.max(1, m.priceInrPerKg);
  const totalKg = today.reduce((a, m) => a + kgOf(m), 0) || 1;
  const clean = (label: string) => label.replace(/ \(.*\)$/, "");
  const nowBy: Record<string, number> = {};
  for (const m of today) for (const c of m.lines) nowBy[clean(c.label)] = (nowBy[clean(c.label)] ?? 0) + (c.perKg * kgOf(m)) / totalKg;
  const thenBy: Record<string, number> = {};
  const snapLines = Object.values((snap?.byLine ?? {}) as Record<number, MarginResult>);
  const snapKg = snapLines.reduce((a, m) => a + kgOf(m), 0);
  if (snapKg) for (const m of snapLines) for (const c of m.lines ?? []) thenBy[clean(c.label)] = (thenBy[clean(c.label)] ?? 0) + (c.perKg * kgOf(m)) / snapKg;
  const costPerKg = Object.values(nowBy).reduce((a, v) => a + v, 0) || 1;
  const costs = Object.entries(nowBy).map(([label, now]) => ({ label, then: snapKg ? (thenBy[label] ?? 0) : null, now, share: (now / costPerKg) * 100 }));

  return {
    costs,
    origin: order.beanOrigin,
    grade: order.gbGrade,
    fixed,
    pricedAt,
    marketNow,
    changePct,
    beanTonnes: Math.round(today.reduce((a, m) => a + m.greenBeanKg, 0) / 100) / 10,
    shareOfCost: cost ? (beanCost / cost) * 100 : 0,
    marginThen: snap?.marginPct ?? null,
    marginToday,
    minPct,
    risk,
    note,
  };
}
