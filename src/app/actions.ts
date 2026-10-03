"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { resetStore, store } from "@/data/store";
import { earliestArrivalMonth, inventoryProjection, type ExtraNeed } from "@/lib/inventory";
import { describeMaterial, requirementsFor } from "@/lib/procurement";
import { APPROVER_ROLES, can, CURRENCIES, FREIGHT_BASIS, PRODUCT_TYPES, ROLES, type ApproverRole, type Role } from "@/lib/domain";
import { getViewer, VIEWER_COOKIE } from "@/lib/role";
import {
  applyMove,
  cancelOrder,
  decide,
  evaluateOrder,
  reassignOrder,
  saveOrder,
  addReservation,
  createPurchaseOrder,
  dismissRequest,
  planAvailability,
  raisePurchaseRequest,
  receivePurchaseOrder,
  actor,
  carryOverShort,
  changeDayCapacity,
  closeDay,
  markNotRunning,
  resumeDay,
  recordProduction,
  startDay,
  removeReservation,
  setLineSetup,
  setMonthCapacity,
  setStock,
  setGbClosure,
  simulateMove,
  submitErrors,
  ValidationError,
  WorkflowError,
  type MoveRequest,
  type OrderInput,
} from "@/lib/workflow";
import { nextId } from "@/data/store";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month");
const num = z.coerce.number().catch(0);

const lineSchema = z.object({
  id: z.number().int().positive().optional(),
  skuId: num,
  chicoryPct: num,
  month: z.string().catch(""),
  quantityMt: num,
  pricePerKg: num,
  lineId: num,
});

const orderSchema = z.object({
  customerId: z.number().int().positive().nullable().catch(null),
  newCustomerName: z.string().trim().catch(""),
  customerCountry: z.string().trim().catch(""),
  contactPerson: z.string().trim().catch(""),
  customerType: z.enum(["NEW", "REPEAT"]).catch("NEW"),
  bdOwnerId: num,
  destinationCountry: z.string().trim().catch(""),
  destinationPort: z.string().trim().catch(""),
  incoterm: z.string().catch(""),
  freightBasis: z.enum(Object.keys(FREIGHT_BASIS) as [string, ...string[]]).catch("SELLER"),
  gbGrade: z.string().catch(""),
  beanOrigin: z.string().catch(""),
  gbPriceClosed: z.boolean().catch(false),
  gbClosedPrice: z.coerce.number().nullable().catch(null),
  advancePct: num,
  creditDays: num,
  paymentMode: z.string().catch(""),
  currency: z.enum(CURRENCIES).catch("INR"),
  specNotes: z.string().max(2000).catch(""),
  spillOverride: z.string().max(1000).catch(""),
  shipments: z.array(z.object({ month, quantityMt: z.number().min(0).max(100000) })).max(60).catch([]),
  lines: z.array(lineSchema).max(60),
});

function parseOrder(raw: unknown): OrderInput {
  return orderSchema.parse(raw) as OrderInput;
}

async function requireRole(allowed: Role[]) {
  const viewer = await getViewer();
  if (!can(viewer.role, allowed)) throw new WorkflowError(`This needs ${allowed.join(" or ")} access`);
  return viewer;
}

function done(path = "/") {
  revalidatePath(path, "layout");
}

export async function setViewer(value: string) {
  const valid = value === "ALL" || store().users.some((u) => String(u.id) === value);
  if (!valid) return;
  (await cookies()).set(VIEWER_COOKIE, value, { path: "/", sameSite: "lax", httpOnly: true });
  done();
}

export async function previewOrder(raw: unknown, orderId?: number) {
  const input = parseOrder(raw);
  const ev = evaluateOrder(input, orderId);
  const s = ev.settings;

  // Materials: run the stock projection with this order added, so earlier months' use carries into later ones.
  const extra: ExtraNeed[] = [];
  input.lines.forEach((l, i) => {
    const sku = ev.lines[i].sku;
    if (!sku || !(l.quantityMt > 0) || !input.beanOrigin || !input.gbGrade) return;
    for (const d of requirementsFor(sku, input, { month: l.month, quantityMt: l.quantityMt }, s)) {
      extra.push({ key: d.key, group: d.group, name: d.material, unit: d.unit, month: d.productionMonth, quantity: d.quantity });
    }
  });
  const projection = inventoryProjection(undefined, { excludeOrderId: orderId, extra });
  const needKeys = new Map<string, { key: string; month: string; need: number }>();
  for (const x of extra) {
    const k = `${x.key}@${x.month}`;
    const e = needKeys.get(k) ?? { key: x.key, month: x.month, need: 0 };
    e.need += x.quantity;
    needKeys.set(k, e);
  }
  const materials = [...needKeys.values()]
    .map((n) => {
      const row = projection.find((r) => r.key === n.key);
      const cell = row?.cells[n.month];
      const info = describeMaterial(n.key);
      const earliest = row?.earliestArrival ?? earliestArrivalMonth(n.key, s);
      const short = Math.min(n.need, cell?.short ?? n.need);
      return { ...n, name: info.name, unit: info.unit, remaining: Math.max(0, n.need - short), short, earliestArrival: earliest, canArriveInTime: earliest <= n.month };
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.name.localeCompare(b.name));

  // Price that lands exactly on the minimum profit (cost has a fixed part plus the credit cost on price).
  const first = ev.lines.find((l) => l.margin)?.margin;
  let minPrice: number | null = null;
  if (first) {
    const creditShare = (s["finance.cost_pct_30d"] / 100) * (input.creditDays / 30) * (1 - Math.min(Math.max(input.advancePct, 0), 100) / 100);
    const weightedCost = ev.lines.reduce((a, l) => a + (l.margin ? (l.margin.costPerKg - l.margin.priceInrPerKg * creditShare) * l.margin.revenue : 0), 0) / Math.max(1, ev.margin.revenue);
    const denom = 1 - creditShare - s["margin.target_pct"] / 100;
    if (denom > 0) minPrice = weightedCost / denom / (input.currency === "USD" ? s["fx.usd_inr"] : 1);
  }

  return {
    lines: ev.lines.map((l) => ({
      lineCode: l.lineCode,
      lineError: l.lineError,
      capacity: l.capacity,
      free: l.free,
      after: l.after,
      spill: l.spill,
      value: l.value,
      marginPct: l.margin?.marginPct ?? null,
      marginPerKg: l.margin?.marginPerKg ?? null,
      costPerKg: l.margin?.costPerKg ?? null,
      belowMin: l.belowMin,
      materialWarning: l.materialWarning,
    })),
    costLines: first?.lines ?? [],
    priceInrPerKg: first?.priceInrPerKg ?? 0,
    margin: { revenue: ev.margin.revenue, totalMargin: ev.margin.totalMargin, marginPct: ev.margin.marginPct, targetPct: ev.margin.targetPct, greenBeanKg: ev.margin.greenBeanKg },
    minPrice,
    materials,
    issues: ev.issues,
    errors: submitErrors(input, ev),
  };
}

export async function saveOrderAction(raw: unknown, intent: "draft" | "submit", orderId?: number): Promise<{ errors?: Record<string, string>; message?: string }> {
  let id: number;
  try {
    const viewer = await getViewer();
    id = saveOrder(parseOrder(raw), viewer, intent, orderId);
  } catch (e) {
    if (e instanceof ValidationError) return { errors: e.errors, message: e.message };
    if (e instanceof WorkflowError) return { message: e.message };
    throw e;
  }
  done();
  redirect(`/orders/${id}`);
}

export async function decideAction(orderId: number, role: string, decision: "APPROVED" | "REJECTED" | "SENT_BACK", comment: string) {
  if (!APPROVER_ROLES.includes(role as ApproverRole)) return { error: "Unknown approver" };
  try {
    decide(orderId, role as ApproverRole, decision, comment.trim(), await getViewer());
  } catch (e) {
    if (e instanceof WorkflowError) return { error: e.message };
    throw e;
  }
  done();
  return { error: null };
}

export async function cancelAction(orderId: number, reason: string) {
  try {
    cancelOrder(orderId, reason, await getViewer());
  } catch (e) {
    if (e instanceof WorkflowError) return { error: e.message };
    throw e;
  }
  done();
  return { error: null };
}

export async function reassignAction(orderId: number, bdOwnerId: number, priority: "NORMAL" | "HIGH") {
  try {
    reassignOrder(orderId, bdOwnerId, priority, await getViewer());
  } catch (e) {
    if (e instanceof WorkflowError) return { error: e.message };
    throw e;
  }
  done();
  return { error: null };
}

export async function gbClosureAction(orderId: number, closed: boolean, price: number | null) {
  try {
    setGbClosure(orderId, closed, price, await getViewer());
  } catch (e) {
    if (e instanceof WorkflowError) return { error: e.message };
    throw e;
  }
  done();
  return { error: null };
}

type Result = { error: string | null };

async function run(fn: (viewer: Awaited<ReturnType<typeof getViewer>>) => unknown): Promise<Result> {
  try {
    fn(await getViewer());
  } catch (e) {
    if (e instanceof WorkflowError) return { error: e.message };
    throw e;
  }
  done();
  return { error: null };
}

export async function availabilityAction(productType: string, months: string[], need: number | Record<string, number>, orderId?: number, blend = "PURE") {
  const valid = months.filter((m) => month.safeParse(m).success).slice(0, 24);
  const clean = typeof need === "number" ? Math.max(0, Number(need) || 0) : Object.fromEntries(valid.map((m) => [m, Math.max(0, Number(need[m]) || 0)]));
  return planAvailability(productType, valid, clean, orderId, blend === "CHICORY" ? "CHICORY" : "PURE");
}

export async function monthCapacityAction(lineId: number, monthKey: string, capacityMt: number, note: string) {
  if (!month.safeParse(monthKey).success) return { error: "Invalid month" };
  return run((v) => setMonthCapacity(lineId, monthKey, Number(capacityMt), String(note ?? ""), v));
}

export async function reserveAction(lineId: number, monthKey: string, quantityMt: number, label: string, productType: string) {
  if (!month.safeParse(monthKey).success) return { error: "Invalid month" };
  return run((v) => addReservation(lineId, monthKey, Number(quantityMt), String(label ?? ""), productType, v));
}

export async function carryOverAction(allocationId: number) {
  return run((v) => carryOverShort(Number(allocationId), v));
}

export async function startDayAction(lineId: number, date: string, allocationId: number | null, capacityT: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Invalid date" };
  return run((v) => startDay(Number(lineId), date, allocationId ? Number(allocationId) : null, Number(capacityT), v));
}

export async function dayCapacityAction(id: number, capacityT: number, reason: string) {
  return run((v) => changeDayCapacity(Number(id), Number(capacityT), String(reason ?? ""), v));
}

export async function notRunningAction(lineId: number, date: string, reason: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Invalid date" };
  return run((v) => markNotRunning(Number(lineId), date, String(reason ?? ""), v));
}

export async function resumeDayAction(id: number) {
  return run((v) => resumeDay(Number(id), v));
}

export async function closeDayAction(id: number, madeT: number, reason = "") {
  return run((v) => closeDay(Number(id), Number(madeT), v, String(reason ?? "")));
}

export async function recordProductionAction(allocationId: number, producedMt: number, note: string) {
  return run((v) => recordProduction(Number(allocationId), Number(producedMt), String(note ?? ""), v));
}

export async function releaseReservationAction(id: number) {
  return run((v) => removeReservation(id, v));
}

export async function lineSetupAction(lineId: number, setup: { capacityMt: number; productTypes: string[]; active: boolean; capacityConfirmed: boolean; runDays?: number[]; productCaps?: Record<string, number> }) {
  // With a product breakdown, the line makes every product with tonnes > 0 and its capacity is their sum.
  const caps = setup.productCaps
    ? Object.fromEntries(
        Object.entries(setup.productCaps)
          .filter(([p, v]) => Object.keys(PRODUCT_TYPES).includes(p) && Number(v) > 0)
          .map(([p, v]) => [p, Number(v)]),
      )
    : undefined;
  if (caps) {
    setup.productTypes = Object.keys(caps);
    setup.capacityMt = Object.values(caps).reduce((a, v) => a + v, 0);
  }
  const productTypes = (setup.productTypes ?? []).filter((p) => Object.keys(PRODUCT_TYPES).includes(p));
  const runDays = setup.runDays ? [...new Set(setup.runDays.map(Number).filter((d) => d >= 0 && d <= 6))] : undefined;
  return run((v) => setLineSetup(lineId, { capacityMt: Math.max(0, Number(setup.capacityMt) || 0), productTypes, active: !!setup.active, capacityConfirmed: !!setup.capacityConfirmed, runDays, productCaps: caps }, v));
}

export async function requestMaterialAction(materialKey: string, quantity: number, neededBy: string, note: string) {
  if (!month.safeParse(neededBy).success) return { error: "Invalid month" };
  return run((v) => raisePurchaseRequest(materialKey, Number(quantity), neededBy, String(note ?? ""), v));
}

export async function purchaseOrderAction(materialKey: string, quantity: number, arrivalMonth: string, supplier: string, requestId: number | null) {
  if (!month.safeParse(arrivalMonth).success) return { error: "Invalid month" };
  return run((v) => createPurchaseOrder(materialKey, Number(quantity), arrivalMonth, String(supplier ?? ""), requestId, v));
}

export async function receiveAction(poId: number, receivedQty?: number) {
  return run((v) => receivePurchaseOrder(poId, v, receivedQty == null ? undefined : Number(receivedQty)));
}

export async function dismissRequestAction(id: number) {
  return run((v) => dismissRequest(id, v));
}

export async function stockAction(materialKey: string, onHand: number) {
  return run((v) => setStock(materialKey, Number(onHand), v));
}

const moveSchema = z.object({ allocationId: z.number().int().positive(), lineId: z.number().int().positive(), month, quantityMt: z.number().positive() });

export async function simulatePlanMove(req: MoveRequest) {
  const parsed = moveSchema.safeParse(req);
  if (!parsed.success) return null;
  try {
    return simulateMove(parsed.data);
  } catch (e) {
    if (e instanceof WorkflowError) return null;
    throw e;
  }
}

export async function applyPlanMove(req: MoveRequest) {
  const parsed = moveSchema.safeParse(req);
  if (!parsed.success) return { error: "Invalid move" };
  try {
    applyMove(parsed.data, await getViewer());
  } catch (e) {
    if (e instanceof WorkflowError) return { error: e.message };
    throw e;
  }
  done();
  return { error: null };
}

function nonNegative(raw: FormDataEntryValue | null): number | null {
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function saveSettings(_prev: { message?: string }, formData: FormData): Promise<{ message?: string }> {
  try {
    await requireRole(["CFO", "COO", "ADMIN"]);
  } catch (e) {
    return { message: (e as Error).message };
  }
  const rows = store().settings;
  const updates: { key: string; value: number }[] = [];
  for (const r of rows) {
    if (formData.get(r.key) === null) continue;
    const n = nonNegative(formData.get(r.key));
    if (n === null) return { message: `Invalid value for ${r.label}` };
    if (n !== r.value) updates.push({ key: r.key, value: n });
  }
  if (!updates.length) return { message: "No changes." };
  const viewer = await getViewer();
  for (const u of updates) {
    const row = rows.find((r) => r.key === u.key)!;
    store().auditLog.push({ id: nextId("audit"), at: new Date(), by: actor(viewer, "CFO").name, role: actor(viewer, "CFO").role, action: "NORMS", orderId: null, detail: `${row.label}: ${row.value} → ${u.value}` });
    row.value = u.value;
  }
  done();
  return { message: `Saved ${updates.length} change${updates.length > 1 ? "s" : ""}. New orders use these norms; submitted orders keep the snapshot they were priced on.` };
}

export async function saveBeanPrices(_prev: { message?: string }, formData: FormData): Promise<{ message?: string }> {
  try {
    await requireRole(["PROCUREMENT", "COO", "CFO", "ADMIN"]);
  } catch (e) {
    return { message: (e as Error).message };
  }
  const rows = store().settings.filter((r) => r.key.startsWith("bean_price."));
  const viewer = await getViewer();
  let changed = 0;
  for (const r of rows) {
    const n = nonNegative(formData.get(r.key));
    if (n === null) return { message: `Invalid price for ${r.label}` };
    if (n !== r.value) {
      store().auditLog.push({ id: nextId("audit"), at: new Date(), by: actor(viewer, "PROCUREMENT").name, role: actor(viewer, "PROCUREMENT").role, action: "GB_PRICE", orderId: null, detail: `${r.label}: ₹${r.value} → ₹${n}` });
      r.value = n;
      changed++;
    }
  }
  done();
  return { message: changed ? "Market GB prices updated." : "No changes." };
}

export async function addCustomer(_prev: { message?: string }, formData: FormData): Promise<{ message?: string }> {
  try {
    await requireRole(["ADMIN", "BD_HEAD"]);
  } catch (e) {
    return { message: (e as Error).message };
  }
  const name = String(formData.get("name") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim();
  const contactPerson = String(formData.get("contactPerson") ?? "").trim();
  const bdOwnerId = Number(formData.get("bdOwnerId"));
  if (!name || !country || !contactPerson || !store().users.some((u) => u.id === bdOwnerId)) return { message: "Fill in name, country, contact and BD owner." };
  if (store().customers.some((c) => c.name.toLowerCase() === name.toLowerCase())) return { message: "That customer already exists." };
  store().customers.push({ id: nextId("customers"), name, country, contactPerson, bdOwnerId });
  done();
  return { message: `Added ${name}.` };
}

export async function addUser(_prev: { message?: string }, formData: FormData): Promise<{ message?: string }> {
  try {
    await requireRole(["ADMIN"]);
  } catch (e) {
    return { message: (e as Error).message };
  }
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "") as Role;
  if (!name || !email || !ROLES.includes(role) || role === "ALL") return { message: "Fill in name, email and role." };
  store().users.push({ id: nextId("users"), name, email, role });
  done();
  return { message: `Added ${name}.` };
}

export async function toggleSku(skuId: number) {
  await requireRole(["ADMIN"]);
  const sku = store().skus.find((s) => s.id === skuId);
  if (sku) sku.active = !sku.active;
  done();
}

export async function resetDemoData() {
  resetStore();
  done();
}
