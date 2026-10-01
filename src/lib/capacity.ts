import { store } from "@/data/store";
import type { Line } from "@/data/types";
import { addMonths, monthRange, planningStart, PRODUCT_TYPES } from "./domain";

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
};

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
  return { lines: lineRows, overrides, rows, reserved, load, packLoad };
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

export function freeAt(state: CapacityState, lineId: number, month: string): number {
  return capacityAt(state, lineId, month) - loadAt(state, lineId, month);
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
