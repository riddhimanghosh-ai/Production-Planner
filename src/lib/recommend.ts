import { store } from "@/data/store";
import { capacityAt, freeAt, linesFor, loadCapacityState, productFreeAt, type AllocationRow, type CapacityState } from "./capacity";
import { addMonths, monthLabel, planningStart, productLabel, PRODUCT_TYPES, type ProductType } from "./domain";
import { inventoryProjection } from "./inventory";
import { requirementsFor } from "./procurement";
import { loadSettings, type Settings } from "./settings";
import { withShare } from "./workflow";

// One thing for the planner to place: a new order's slot, or the extra tonnes in an overbooked month.
export type Suggestion = {
  allocationId: number;
  orderId: number;
  ref: string;
  customer: string;
  status: string;
  product: string;
  productType: string;
  slotMt: number; // tonnes planned in this slot
  moveMt: number; // tonnes the suggestion moves (less than slotMt when only the overbooked part needs to go)
  deliveryMonth: string;
  current: { lineId: number; line: string; month: string; problem: string | null };
  best: { lineId: number; line: string; month: string; free: number; materialsOk: boolean; partial: boolean } | null;
  keep: boolean;
  reason: string;
};

type Candidate = { lineId: number; line: string; month: string; free: number; fits: boolean; materialsOk: boolean; late: boolean; isCurrent: boolean; gap: number };
type Target = { r: AllocationRow; qty: number; overbooked: boolean };

export function planSuggestions(): Suggestion[] {
  const st = store();
  const s = loadSettings();
  const state = loadCapacityState();
  const projection = inventoryProjection();
  const first = planningStart();

  // Overbooked month: only the extra tonnes need a new home. Move new (unapproved) orders first, biggest first.
  const targets: Target[] = [];
  const cells = new Map<string, AllocationRow[]>();
  for (const r of state.rows) cells.set(`${r.lineId}|${r.month}`, [...(cells.get(`${r.lineId}|${r.month}`) ?? []), r]);
  const inOverbooked = new Set<number>();
  for (const rows of cells.values()) {
    let over = -freeAt(state, rows[0].lineId, rows[0].month);
    if (over <= 0.05) continue;
    for (const r of [...rows].sort((a, b) => Number(a.status === "COMMITTED") - Number(b.status === "COMMITTED") || b.quantityMt - a.quantityMt)) {
      inOverbooked.add(r.id);
      if (over <= 0.05) continue;
      const take = Math.min(r.quantityMt, Math.ceil(over * 10) / 10);
      targets.push({ r, qty: take, overbooked: true });
      over -= take;
    }
  }
  // Every other new order: check it sits in the best place.
  for (const r of state.rows) if (r.status !== "COMMITTED" && !inOverbooked.has(r.id)) targets.push({ r, qty: r.quantityMt, overbooked: false });

  // Space already promised to an earlier suggestion, so two suggestions never fill the same gap twice.
  const claimed = new Map<string, number>();
  return targets.map((t) => suggestFor(t, state, projection, s, first, st, claimed)).sort((a, b) => Number(a.keep) - Number(b.keep) || a.current.month.localeCompare(b.current.month) || a.ref.localeCompare(b.ref));
}

function suggestFor({ r, qty, overbooked }: Target, state: CapacityState, projection: ReturnType<typeof inventoryProjection>, s: Settings, first: string, st: ReturnType<typeof store>, claimed: Map<string, number>): Suggestion {
  const order = st.orders.find((o) => o.id === r.orderId)!;
  const ol = st.orderLines.find((l) => l.id === r.orderLineId)!;
  const sku = withShare(
    st.skus.find((x) => x.id === ol.skuId)!,
    ol.chicoryPct,
  );
  const delivery = ol.month;
  const lineCode = (id: number) => state.lines.find((l) => l.id === id)?.code ?? "";

  // Materials: the current month is fine if nothing is short there; another month needs spare stock for these tonnes.
  const materialsOkAt = (month: string, isCurrent: boolean, tonnes: number) =>
    requirementsFor(sku, order, { month, quantityMt: tonnes }, s).every((d) => {
      const cell = projection.find((p) => p.key === d.key)?.cells[month];
      if (!cell) return false;
      return isCurrent ? cell.short <= 0.5 : Math.max(0, cell.available - cell.need) + 0.5 >= d.quantity;
    });

  // Two months before delivery up to the delivery month; later months only as a last resort.
  const months = [-2, -1, 0, 1, 2].map((d) => addMonths(delivery, d)).filter((m) => m >= first);
  const candidates: Candidate[] = [];
  for (const line of linesFor(state, r.productType)) {
    for (const month of months) {
      const isCurrent = line.id === r.lineId && month === r.month;
      const free = freeAt(state, line.id, month) - (claimed.get(`${line.id}|${month}`) ?? 0) + (isCurrent ? qty : 0);
      candidates.push({
        lineId: line.id,
        line: line.code,
        month,
        free,
        fits: free + 0.05 >= qty && capacityAt(state, line.id, month) > 0,
        materialsOk: materialsOkAt(month, isCurrent, qty),
        late: month > delivery,
        isCurrent,
        gap: Math.abs(monthDiff(delivery, month)),
      });
    }
  }

  // Rank: fits > on time > materials ready > closest to delivery > stay put > most room left.
  const rank = (c: Candidate) => [c.fits ? 0 : 1, c.late ? 1 : 0, c.materialsOk ? 0 : 1, c.gap, c.isCurrent ? 0 : 1, -c.free];
  const cmp = (a: Candidate, b: Candidate) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  };
  candidates.sort(cmp);

  const cur = candidates.find((c) => c.isCurrent);
  const problem = !cur
    ? `${lineCode(r.lineId)} can't make ${PRODUCT_TYPES[r.productType as ProductType]?.toLowerCase()}`
    : overbooked
      ? `${lineCode(r.lineId)} is overbooked in ${monthLabel(r.month)}`
      : cur.late
        ? "Made after the delivery month"
        : !cur.materialsOk
          ? `Materials short in ${monthLabel(r.month)}`
          : null;

  const top = candidates[0]?.fits ? candidates[0] : null;
  const keep = !!top && !overbooked && (top.isCurrent || (!!cur && rank(top).slice(0, 4).join() === rank(cur).slice(0, 4).join()));

  let best: Suggestion["best"] = null;
  let moveMt = qty;
  let reason: string;
  if (keep) {
    best = { lineId: cur!.lineId, line: cur!.line, month: cur!.month, free: cur!.free, materialsOk: cur!.materialsOk, partial: false };
    reason = `Fits where it is, ${fmt(cur!.free - qty)} to spare${cur!.materialsOk ? ", materials covered" : ", but ask procurement for materials"}.`;
  } else if (top) {
    best = { lineId: top.lineId, line: top.line, month: top.month, free: top.free, materialsOk: top.materialsOk, partial: false };
    const lead = monthDiff(top.month, delivery);
    reason = [
      `${top.line} has ${fmt(top.free)} free in ${monthLabel(top.month)}`,
      top.materialsOk ? "materials covered" : "materials still need buying",
      top.late ? "but this is after delivery, agree with the customer" : lead > 0 ? `ready ${lead} month${lead > 1 ? "s" : ""} before delivery` : "made in the delivery month",
    ].join(", ");
  } else {
    // Nothing takes it all: suggest the biggest part that fits somewhere on time.
    const part = candidates.filter((c) => !c.isCurrent && !c.late && c.free >= 1).sort((a, b) => b.free - a.free)[0];
    if (part) {
      moveMt = Math.floor(part.free * 10) / 10;
      best = { lineId: part.lineId, line: part.line, month: part.month, free: part.free, materialsOk: materialsOkAt(part.month, false, moveMt), partial: true };
      reason = `No single slot takes ${fmt(qty)}. Move ${fmt(moveMt)} to ${part.line} in ${monthLabel(part.month)}; for the other ${fmt(qty - moveMt)}, add capacity or agree a later month with sales.`;
    } else {
      reason = `Every line that makes ${PRODUCT_TYPES[r.productType as ProductType]?.toLowerCase()} is full around ${monthLabel(delivery)}. Add capacity (overtime, extra shift) or agree a later month with sales.`;
    }
  }

  if (best && !keep) claimed.set(`${best.lineId}|${best.month}`, (claimed.get(`${best.lineId}|${best.month}`) ?? 0) + moveMt);

  return {
    allocationId: r.id,
    orderId: r.orderId,
    ref: r.orderRef,
    customer: r.customer,
    status: r.status,
    product: productLabel(sku, ol.chicoryPct),
    productType: r.productType,
    slotMt: r.quantityMt,
    moveMt,
    deliveryMonth: delivery,
    current: { lineId: r.lineId, line: lineCode(r.lineId), month: r.month, problem },
    best,
    keep,
    reason,
  };
}

// Where new production can start: free tonnes per product per month, and on which lines.
export type OpenRoom = { productType: string; lines: string[]; months: Record<string, { free: number; byLine: { line: string; free: number }[] }> };

export function openRoom(months: string[]): OpenRoom[] {
  const state = loadCapacityState();
  return (Object.keys(PRODUCT_TYPES) as ProductType[]).map((pt) => {
    const capable = linesFor(state, pt);
    const cells: OpenRoom["months"] = {};
    for (const m of months) {
      const byLine = capable.map((l) => ({ line: l.code, free: Math.max(0, productFreeAt(state, l.id, pt, m)) }));
      cells[m] = { free: byLine.reduce((a, x) => a + x.free, 0), byLine };
    }
    return { productType: pt, lines: capable.map((l) => l.code), months: cells };
  });
}

function monthDiff(a: string, b: string) {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return yb * 12 + mb - (ya * 12 + ma);
}

const fmt = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} t`;
