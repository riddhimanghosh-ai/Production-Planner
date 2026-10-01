import { store } from "@/data/store";
import { LOADING_STATUSES, planHorizon } from "./capacity";
import { addDays, addMonths, isoDate, todayIso } from "./domain";
import { MATERIAL_GROUPS, requirementsFor } from "./procurement";
import { loadSettings, type Settings } from "./settings";
import { withShare } from "./workflow";

export type NeedOrder = { orderId: number; ref: string; customer: string; status: string; lineId: number; quantity: number };
export type MonthCell = { need: number; firm: number; tentative: number; arriving: number; available: number; short: number; balanceAfter: number; orders: NeedOrder[] };
export type MaterialRow = { key: string; group: string; name: string; unit: string; onHand: number; onOrder: number; leadDays: number; earliestArrival: string; cells: Record<string, MonthCell> };

export function leadDaysFor(key: string, s: Settings): number {
  if (key.startsWith("GB|")) return s[`lead.transit.${key.split("|")[1]}`] + s["lead.bean_buffer"];
  if (key === "CHICORY") return s["lead.chicory"];
  if (key.startsWith("CAN|")) return s["lead.cans"];
  return s["lead.packaging"];
}

// A purchase placed today can cover production from this month onward.
export function earliestArrivalMonth(key: string, s: Settings, asOf = todayIso()): string {
  const ready = addDays(new Date(`${asOf}T00:00:00Z`), leadDaysFor(key, s) + s["lead.material_before_production"]);
  const month = isoDate(ready).slice(0, 7);
  return ready.getUTCDate() === 1 ? month : addMonths(month, 1);
}

export type ExtraNeed = { key: string; group: string; name: string; unit: string; month: string; quantity: number };

export function inventoryProjection(months = planHorizon(18), opts: { excludeOrderId?: number; extra?: ExtraNeed[] } = {}) {
  const st = store();
  const s = loadSettings();
  const rows = new Map<string, MaterialRow>();
  const ensure = (key: string, group: string, name: string, unit: string) => {
    let r = rows.get(key);
    if (!r) {
      const inv = st.inventory.find((i) => i.key === key);
      r = { key, group, name: inv?.name ?? name, unit, onHand: inv?.onHand ?? 0, onOrder: 0, leadDays: leadDaysFor(key, s), earliestArrival: earliestArrivalMonth(key, s), cells: {} };
      rows.set(key, r);
    }
    return r;
  };
  for (const i of st.inventory) ensure(i.key, i.group, i.name, i.unit);

  const needs = new Map<string, Map<string, { firm: number; tentative: number; orders: NeedOrder[] }>>();
  for (const a of st.allocations) {
    const order = st.orders.find((o) => o.id === a.orderId);
    if (!order || !LOADING_STATUSES.includes(order.status) || order.id === opts.excludeOrderId) continue;
    const ol = st.orderLines.find((l) => l.id === a.orderLineId);
    if (!ol) continue;
    const sku = withShare(st.skus.find((x) => x.id === ol.skuId)!, ol.chicoryPct);
    const customer = st.customers.find((c) => c.id === order.customerId)?.name ?? "";
    for (const d of requirementsFor(sku, order, a, s)) {
      ensure(d.key, d.group, d.material, d.unit);
      const byMonth = needs.get(d.key) ?? new Map();
      const cell = byMonth.get(d.productionMonth) ?? { firm: 0, tentative: 0, orders: [] };
      if (order.status === "COMMITTED") cell.firm += d.quantity;
      else cell.tentative += d.quantity;
      const existing = cell.orders.find((o: NeedOrder) => o.orderId === order.id && o.lineId === a.lineId);
      if (existing) existing.quantity += d.quantity;
      else cell.orders.push({ orderId: order.id, ref: order.ref, customer, status: order.status, lineId: a.lineId, quantity: d.quantity });
      byMonth.set(d.productionMonth, cell);
      needs.set(d.key, byMonth);
    }
  }

  for (const x of opts.extra ?? []) {
    ensure(x.key, x.group, x.name, x.unit);
    const byMonth = needs.get(x.key) ?? new Map();
    const cell = byMonth.get(x.month) ?? { firm: 0, tentative: 0, orders: [] };
    cell.tentative += x.quantity;
    cell.orders.push({ orderId: 0, ref: "This order", customer: "", status: "DRAFT", lineId: 0, quantity: x.quantity });
    byMonth.set(x.month, cell);
    needs.set(x.key, byMonth);
  }

  for (const r of rows.values()) {
    const pos = st.purchaseOrders.filter((p) => p.materialKey === r.key && p.status === "ORDERED");
    r.onOrder = pos.reduce((a, p) => a + p.quantity, 0);
    let balance = r.onHand + pos.filter((p) => p.arrivalMonth < months[0]).reduce((a, p) => a + p.quantity, 0);
    for (const m of months) {
      const n = needs.get(r.key)?.get(m) ?? { firm: 0, tentative: 0, orders: [] };
      const arriving = pos.filter((p) => p.arrivalMonth === m).reduce((a, p) => a + p.quantity, 0);
      const need = n.firm + n.tentative;
      const available = Math.max(0, balance + arriving);
      const short = Math.max(0, need - available);
      balance = balance + arriving - need;
      r.cells[m] = { need, firm: n.firm, tentative: n.tentative, arriving, available, short, balanceAfter: balance, orders: n.orders };
    }
  }

  return [...rows.values()].sort((a, b) => MATERIAL_GROUPS.indexOf(a.group as (typeof MATERIAL_GROUPS)[number]) - MATERIAL_GROUPS.indexOf(b.group as (typeof MATERIAL_GROUPS)[number]) || a.name.localeCompare(b.name));
}

export type Shortage = { key: string; name: string; unit: string; month: string; short: number; leadDays: number; earliestArrival: string; orders: NeedOrder[] };

export function shortages(projection = inventoryProjection()): Shortage[] {
  return projection.flatMap((r) =>
    Object.entries(r.cells)
      .filter(([, c]) => c.short > 0.5)
      .map(([month, c]) => ({ key: r.key, name: r.name, unit: r.unit, month, short: c.short, leadDays: r.leadDays, earliestArrival: r.earliestArrival, orders: c.orders })),
  );
}

// Materials status for one line in one month: which of its orders' materials would run short.
export function cellMaterialStatus(lineId: number, month: string, shorts: Shortage[]) {
  return shorts.filter((x) => x.month === month && x.orders.some((o) => o.lineId === lineId));
}
