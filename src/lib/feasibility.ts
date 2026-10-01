import { store } from "@/data/store";
import { monthLabel, monthStartDate, shipmentTonnes } from "./domain";
import { shortages, type Shortage } from "./inventory";
import { freeAt, loadCapacityState } from "./capacity";
import { planAvailability } from "./workflow";

// The COO's question: can we make this order on time?
// 1. Line space: in each ship month, is there room on lines that make this product (ignoring this order's own booking)?
// 2. Materials: is it covered by stock + purchases on the way, and if not, can a purchase still arrive in time given the lead time?
export type Feasibility = {
  verdict: "ok" | "buy" | "no";
  headline: string;
  line: { ok: boolean; short: { month: string; short: number }[] };
  materials: { name: string; unit: string; month: string; short: number; orderBy: Date; earliest: string; canArrive: boolean; late: boolean; leadDays: number }[];
  // Detail for the COO check tab.
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
  const avail = planAvailability(sku.productType, months, needs, orderId);
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
  return { verdict, headline, line: { ok: !lineShort.length, short: lineShort }, materials, perMonth, suggestion: avail.suggestion };
}
