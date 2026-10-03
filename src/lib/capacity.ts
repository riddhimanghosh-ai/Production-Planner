import { store } from "@/data/store";
import type { Line } from "@/data/types";
import { addMonths, monthRange, planningStart, PRODUCT_TYPES } from "./domain";
import { loadSettings, type Settings } from "./settings";

// Submitted and sent-back orders hold capacity softly; approved orders commit it.
export const LOADING_STATUSES = ["PENDING_APPROVAL", "SENT_BACK", "COMMITTED"];

export type AllocationRow = {
  id: number;
  orderId: number;
  orderLineId: number;
  orderRef: string;
  customer: string;
  status: string;
  lineId: number;
  month: string;
  quantityMt: number;
  productType: string;
  blend: string;
  packFormat: string;
  skuCode: string;
};

export type LineWithProducts = Line & { productTypes: string[]; productCaps: Record<string, number> };

export type CapacityState = {
  lines: LineWithProducts[];
  overrides: Map<string, { capacityMt: number; note: string }>;
  rows: AllocationRow[];
  reserved: Map<string, number>;
  load: Map<string, number>;
  packLoad: Map<string, number>;
  changeover: Map<string, Changeover>;
};

// A line that runs more than one product or blend in a month loses cleaning time between runs.
export type Changeover = { switches: { from: string; to: string; hours: number }[]; hours: number; lostMt: number };

export type Issue = {
  kind: "OVERBOOK" | "NO_LINE" | "PACK" | "TOO_SOON" | "PREBUILD" | "MATERIAL";
  severity: "error" | "warning" | "info";
  message: string;
};

const key = (lineId: number, month: string) => `${lineId}|${month}`;
const pkey = (fmt: string, month: string) => `${fmt}|${month}`;
const PT_ORDER = Object.keys(PRODUCT_TYPES);

export function loadLines(opts: { activeOnly?: boolean } = {}): LineWithProducts[] {
  const st = store();
  return st.lines
    .filter((l) => !opts.activeOnly || l.active)
    .sort((a, b) => a.id - b.id)
    .map((l) => ({
      ...l,
      productTypes: st.lineProducts
        .filter((p) => p.lineId === l.id)
        .map((p) => p.productType)
        .sort((a, b) => PT_ORDER.indexOf(a) - PT_ORDER.indexOf(b)),
      productCaps: Object.fromEntries(st.lineProducts.filter((p) => p.lineId === l.id).map((p, _, all) => [p.productType, p.capacityMt ?? l.capacityMt / Math.max(1, all.length)])),
    }));
}

export function loadCapacityState(opts: { excludeOrderId?: number } = {}): CapacityState {
  const st = store();
  const lineRows = loadLines({ activeOnly: true });
  const orderById = new Map(st.orders.map((o) => [o.id, o]));
  const skuById = new Map(st.skus.map((s) => [s.id, s]));
  const lineById = new Map(st.orderLines.map((l) => [l.id, l]));
  const customerById = new Map(st.customers.map((c) => [c.id, c.name]));
  const rows: AllocationRow[] = st.allocations.flatMap((a) => {
    const o = orderById.get(a.orderId);
    const ol = lineById.get(a.orderLineId);
    if (!o || !ol || !LOADING_STATUSES.includes(o.status) || o.id === opts.excludeOrderId) return [];
    const sku = skuById.get(ol.skuId)!;
    return [
      {
        id: a.id,
        orderId: o.id,
        orderLineId: ol.id,
        orderRef: o.ref,
        customer: customerById.get(o.customerId) ?? "",
        status: o.status,
        lineId: a.lineId,
        month: a.month,
        quantityMt: a.quantityMt,
        productType: sku.productType,
        blend: sku.blend,
        packFormat: sku.packFormat,
        skuCode: sku.code,
      },
    ];
  });

  const overrides = new Map(st.capacityOverrides.map((o) => [key(o.lineId, o.month), { capacityMt: o.capacityMt, note: o.note }]));
  const load = new Map<string, number>();
  const reserved = new Map<string, number>();
  const packLoad = new Map<string, number>();
  for (const r of rows) {
    load.set(key(r.lineId, r.month), (load.get(key(r.lineId, r.month)) ?? 0) + r.quantityMt);
    packLoad.set(pkey(r.packFormat, r.month), (packLoad.get(pkey(r.packFormat, r.month)) ?? 0) + r.quantityMt);
  }
  for (const r of st.reservations) {
    reserved.set(key(r.lineId, r.month), (reserved.get(key(r.lineId, r.month)) ?? 0) + r.quantityMt);
    load.set(key(r.lineId, r.month), (load.get(key(r.lineId, r.month)) ?? 0) + r.quantityMt);
  }
  const state = { lines: lineRows, overrides, rows, reserved, load, packLoad, changeover: new Map<string, Changeover>() };
  const s = loadSettings();
  const variants = new Map<string, Set<string>>();
  for (const r of rows) variants.set(key(r.lineId, r.month), (variants.get(key(r.lineId, r.month)) ?? new Set()).add(variantKey(r.productType, r.blend)));
  for (const r of st.reservations) variants.set(key(r.lineId, r.month), (variants.get(key(r.lineId, r.month)) ?? new Set()).add(variantKey(r.productType, "PURE")));
  for (const [k, set] of variants) {
    const [lineId, month] = [Number(k.split("|")[0]), k.split("|")[1]];
    const c = changeoverFor([...set], s, dayCapacity(state, lineId, month));
    if (c.hours > 0) state.changeover.set(k, c);
  }
  return state;
}

export const variantKey = (productType: string, blend: string) => `${productType}:${blend}`;
const VARIANT_LABEL = (v: string) => {
  const [pt, blend] = v.split(":");
  return `${PRODUCT_TYPES[pt as keyof typeof PRODUCT_TYPES] ?? pt}${blend === "CHICORY" ? " + chicory" : ""}`;
};

// Hours for one switch: product change plus blend change, from the changeover settings.
export function switchHours(from: string, to: string, s: Settings): number {
  const [fp, fb] = from.split(":");
  const [tp, tb] = to.split(":");
  let h = 0;
  if (fp !== tp) h += s[`changeover.${fp}_${tp}`] ?? 4;
  if (fb !== tb) h += s[`changeover.${fb}_${tb}`] ?? 4;
  return h;
}

// Best order for a month: group the same product and blend into one run each, ordered so cleaning is least
// (pure before chicory, spray-dried before agglomerated). n different runs means n - 1 changeovers.
export function changeoverFor(variants: string[], s: Settings, dayCap: number): Changeover {
  const order = [...new Set(variants)].sort((a, b) => {
    const [ap, ab] = a.split(":");
    const [bp, bb] = b.split(":");
    return ab.localeCompare(bb) * -1 || ap.localeCompare(bp) * -1;
  });
  const switches = order.slice(1).map((to, i) => ({ from: VARIANT_LABEL(order[i]), to: VARIANT_LABEL(to), hours: switchHours(order[i], to, s) }));
  const hours = switches.reduce((a, x) => a + x.hours, 0);
  return { switches, hours, lostMt: Math.round((hours / 24) * dayCap * 10) / 10 };
}

// Normal tonnes per running day for a line in a month (its run days, Monday to Saturday by default).
export function dayCapacity(state: CapacityState, lineId: number, month: string): number {
  const line = state.lines.find((l) => l.id === lineId);
  const runDays = line?.runDays ?? [1, 2, 3, 4, 5, 6];
  const [y, m] = month.split("-").map(Number);
  let days = 0;
  for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) if (runDays.includes(new Date(y, m - 1, d).getDay())) days++;
  return days ? capacityAt(state, lineId, month) / days : 0;
}

export function changeoverAt(state: CapacityState, lineId: number, month: string): Changeover | null {
  return state.changeover.get(key(lineId, month)) ?? null;
}

// Extra tonnes lost if a new product/blend joins a line-month (no loss if that run is already there or the line is empty).
export function extraChangeoverMt(state: CapacityState, lineId: number, month: string, productType: string, blend: string): number {
  const current = new Set(state.rows.filter((r) => r.lineId === lineId && r.month === month).map((r) => variantKey(r.productType, r.blend)));
  const v = variantKey(productType, blend);
  if (!current.size || current.has(v)) return 0;
  const s = loadSettings();
  const dayCap = dayCapacity(state, lineId, month);
  return Math.max(0, changeoverFor([...current, v], s, dayCap).lostMt - changeoverFor([...current], s, dayCap).lostMt);
}

export function capacityAt(state: CapacityState, lineId: number, month: string): number {
  const o = state.overrides.get(key(lineId, month));
  if (o) return o.capacityMt;
  return state.lines.find((l) => l.id === lineId)?.capacityMt ?? 0;
}

export function noteAt(state: CapacityState, lineId: number, month: string): string {
  return state.overrides.get(key(lineId, month))?.note ?? "";
}

export function loadAt(state: CapacityState, lineId: number, month: string): number {
  return state.load.get(key(lineId, month)) ?? 0;
}

export function reservedAt(state: CapacityState, lineId: number, month: string): number {
  return state.reserved.get(key(lineId, month)) ?? 0;
}

// Free tonnes after orders, reserved time and changeover cleaning time.
export function freeAt(state: CapacityState, lineId: number, month: string): number {
  return capacityAt(state, lineId, month) - loadAt(state, lineId, month) - (changeoverAt(state, lineId, month)?.lostMt ?? 0);
}

export function packLoadAt(state: CapacityState, fmt: string, month: string) {
  return state.packLoad.get(pkey(fmt, month)) ?? 0;
}

// A product's monthly capacity on a line: its normal share, scaled when the month's capacity is changed (e.g. maintenance).
export function productCapAt(state: CapacityState, lineId: number, productType: string, month: string): number {
  const line = state.lines.find((l) => l.id === lineId);
  if (!line || !line.productTypes.includes(productType)) return 0;
  const share = line.productCaps[productType] ?? 0;
  return line.capacityMt > 0 ? (share * capacityAt(state, lineId, month)) / line.capacityMt : 0;
}

export function productLoadAt(state: CapacityState, lineId: number, productType: string, month: string): number {
  const orders = state.rows.filter((r) => r.lineId === lineId && r.month === month && r.productType === productType).reduce((a, r) => a + r.quantityMt, 0);
  const held = store()
    .reservations.filter((r) => r.lineId === lineId && r.month === month && r.productType === productType)
    .reduce((a, r) => a + r.quantityMt, 0);
  return orders + held;
}

// Free tonnes for one product on a line: limited by the product's share and by the line's total.
export function productFreeAt(state: CapacityState, lineId: number, productType: string, month: string): number {
  return Math.min(freeAt(state, lineId, month), productCapAt(state, lineId, productType, month) - productLoadAt(state, lineId, productType, month));
}

export function linesFor(state: CapacityState, productType: string) {
  return state.lines.filter((l) => l.productTypes.includes(productType));
}

export function planHorizon(months = 18) {
  const start = planningStart();
  return monthRange(start, addMonths(start, months - 1));
}
