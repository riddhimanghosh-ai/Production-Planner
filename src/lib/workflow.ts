import { nextId, store, transaction } from "@/data/store";
import type { Order, OrderLine, Sku } from "@/data/types";
import { capacityAt, freeAt, linesFor, loadAt, loadCapacityState, packLoadAt, productFreeAt, type CapacityState, type Issue } from "./capacity";
import {
  APPROVER_FOCUS,
  can,
  coffeeShare,
  formatDate,
  monthLabel,
  planningStart,
  PRODUCT_TYPES,
  todayIso,
  type ApproverRole,
  type Role,
} from "./domain";
import { computeMargin, rollUp, type MarginResult, type OrderMargin } from "./margin";
import { inventoryProjection } from "./inventory";
import { describeMaterial, earliestMaterialMonth, requirementsFor } from "./procurement";
import { loadSettings, type Settings } from "./settings";

export type Viewer = { id: number | null; name: string; role: Role };

export type LineInput = { id?: number; skuId: number; chicoryPct: number; month: string; quantityMt: number; pricePerKg: number; lineId: number };

export type OrderInput = {
  customerId: number | null;
  newCustomerName: string;
  customerCountry: string;
  contactPerson: string;
  customerType: "NEW" | "REPEAT";
  bdOwnerId: number;
  destinationCountry: string;
  destinationPort: string;
  incoterm: string;
  freightBasis: string;
  gbGrade: string;
  beanOrigin: string;
  gbPriceClosed: boolean;
  gbClosedPrice: number | null;
  advancePct: number;
  creditDays: number;
  paymentMode: string;
  currency: string;
  specNotes: string;
  spillOverride: string;
  lines: LineInput[];
};

export class WorkflowError extends Error {}

export class ValidationError extends WorkflowError {
  constructor(public errors: Record<string, string>) {
    super("Some fields need attention");
  }
}

const EDITABLE = ["DRAFT", "SENT_BACK", "PENDING_APPROVAL", "COMMITTED"];

export function withShare<T extends Sku>(sku: T, chicoryPct: number) {
  return { ...sku, coffeeShare: coffeeShare(sku.blend, chicoryPct) };
}

function findOrder(id: number): Order {
  const order = store().orders.find((o) => o.id === id);
  if (!order) throw new WorkflowError("Order not found");
  return order;
}

function skuOf(skuId: number): Sku | undefined {
  return store().skus.find((s) => s.id === skuId);
}

// Which job an action belongs to, so "All access" demo actions are recorded under the right person.
const ACTION_ROLE: Record<string, Role> = {
  CREATED: "BD_EXEC",
  EDITED: "BD_EXEC",
  SUBMITTED: "BD_EXEC",
  CANCELLED: "BD_EXEC",
  REASSIGNED: "BD_HEAD",
  LINE_SETUP: "COO",
  COMMITTED: "COO",
  GB_CLOSURE: "PROCUREMENT",
  PURCHASE_ORDER: "PROCUREMENT",
  RECEIVED: "PROCUREMENT",
  STOCK: "PROCUREMENT",
  GB_PRICE: "PROCUREMENT",
  NORMS: "CFO",
};

// The person an action is recorded under. For the All access demo viewer, pick whoever normally does that job
// (the order's own salesperson for sales actions) so no record reads "All access".
export function actor(viewer: Viewer, role: Role, orderId?: number | null): { name: string; role: Role } {
  if (viewer.role !== "ALL") return { name: viewer.name, role: viewer.role };
  const st = store();
  if ((role === "BD_EXEC" || role === "BD_HEAD") && orderId) {
    const owner = st.users.find((u) => u.id === st.orders.find((o) => o.id === orderId)?.bdOwnerId);
    if (owner && role === "BD_EXEC") return { name: owner.name, role: owner.role };
  }
  const u = st.users.find((x) => x.role === role);
  return { name: u?.name ?? viewer.name, role };
}

function audit(viewer: Viewer, action: string, orderId: number | null, detail: string, role?: Role) {
  const a = actor(viewer, role ?? ACTION_ROLE[action] ?? "PLANNER", orderId);
  store().auditLog.push({ id: nextId("audit"), at: new Date(), by: a.name, role: a.role, action, orderId, detail });
}

export function canEditOrder(viewer: Viewer, order: Pick<Order, "bdOwnerId" | "status">) {
  if (!EDITABLE.includes(order.status)) return false;
  return can(viewer.role, ["BD_HEAD"]) || (viewer.role === "BD_EXEC" && viewer.id === order.bdOwnerId);
}

export function canSeeCommercials(viewer: Viewer, order: Pick<Order, "bdOwnerId">) {
  return viewer.role !== "BD_EXEC" || viewer.id === order.bdOwnerId;
}

// ---------- Evaluation: live capacity check and margin for every line ----------

export type LineEval = {
  index: number;
  sku: (Sku & { coffeeShare: number }) | null;
  lineCode: string;
  lineValid: boolean;
  lineError: string | null;
  capacity: number;
  bookedOthers: number;
  thisOrderBefore: number;
  free: number;
  after: number;
  spill: number;
  margin: MarginResult | null;
  belowMin: boolean;
  materialWarning: string | null;
  value: number;
};

export function suggestLine(state: CapacityState, productType: string, month: string) {
  return linesFor(state, productType).sort((a, b) => freeAt(state, b.id, month) - freeAt(state, a.id, month))[0]?.id;
}

export type MonthAvailability = {
  month: string;
  need: number;
  lines: { lineId: number; code: string; name: string; capacity: number; free: number }[];
  proposal: { lineId: number; quantityMt: number }[];
  short: number;
};

// For each requested month, how much space the capable lines have and how the tonnes would split across them.
export function planAvailability(productType: string, months: string[], qtyPerMonth: number, excludeOrderId?: number) {
  const state = loadCapacityState({ excludeOrderId });
  const capable = linesFor(state, productType);
  const perMonth: MonthAvailability[] = months.map((month) => {
    const lines = capable.map((l) => ({ lineId: l.id, code: l.code, name: l.name, capacity: capacityAt(state, l.id, month), free: Math.max(0, productFreeAt(state, l.id, productType, month)) }));
    let left = qtyPerMonth;
    const proposal: { lineId: number; quantityMt: number }[] = [];
    for (const l of [...lines].sort((a, b) => b.free - a.free)) {
      const take = Math.min(left, l.free);
      if (take > 0.05) {
        proposal.push({ lineId: l.lineId, quantityMt: Math.round(take * 10) / 10 });
        left -= take;
      }
    }
    return { month, need: qtyPerMonth, lines, proposal, short: Math.max(0, Math.round(left * 10) / 10) };
  });
  // Nearest run of the same length (earlier or later than asked) where every month has room for the full quantity.
  let suggestion: string | null = null;
  if (perMonth.some((m) => m.short > 0) && months.length) {
    const len = months.length;
    const fits = (start: string) => {
      for (let k = 0; k < len; k++) {
        const m = addMonthsLocal(start, k);
        if (capable.reduce((a, l) => a + Math.max(0, productFreeAt(state, l.id, productType, m)), 0) < qtyPerMonth) return false;
      }
      return true;
    };
    const first = planningStart();
    for (let d = 1; d <= 18 && !suggestion; d++) {
      const earlier = addMonthsLocal(months[0], -d);
      const later = addMonthsLocal(months[0], d);
      if (earlier >= first && fits(earlier)) suggestion = earlier;
      else if (fits(later)) suggestion = later;
    }
  }
  return { perMonth, capable: capable.map((l) => ({ id: l.id, code: l.code, name: l.name })), suggestion };
}

function addMonthsLocal(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

type EvalInput = Pick<OrderInput, "lines" | "beanOrigin" | "gbPriceClosed" | "gbClosedPrice" | "freightBasis" | "advancePct" | "creditDays" | "currency">;

export function evaluateOrder(input: EvalInput, excludeOrderId?: number, materialsOrderedOn = todayIso()) {
  const s = loadSettings();
  const state = loadCapacityState({ excludeOrderId });
  const withinOrder = new Map<string, number>();
  const issues: Issue[] = [];

  const lines: LineEval[] = input.lines.map((l, index) => {
    const base = skuOf(l.skuId);
    const sku = base ? withShare(base, l.chicoryPct) : null;
    const line = state.lines.find((x) => x.id === l.lineId);
    const pt = sku?.productType ?? "";
    const lineValid = !!sku && !!line && line.productTypes.includes(pt);
    const ptName = PRODUCT_TYPES[pt as keyof typeof PRODUCT_TYPES] ?? pt;
    const lineError = !sku ? null : !line ? "Pick a production line" : !lineValid ? `${line.code} can't make ${ptName.toLowerCase()}` : null;
    const k = `${l.lineId}|${l.month}`;
    const capacity = lineValid ? capacityAt(state, l.lineId, l.month) : 0;
    const bookedOthers = lineValid ? loadAt(state, l.lineId, l.month) : 0;
    const thisOrderBefore = withinOrder.get(k) ?? 0;
    const qty = l.quantityMt > 0 ? l.quantityMt : 0;
    withinOrder.set(k, thisOrderBefore + qty);
    const free = capacity - bookedOthers - thisOrderBefore;
    const after = free - qty;
    const spill = lineValid && after < -0.05 ? -after : 0;

    const margin =
      sku && l.pricePerKg > 0 && qty > 0
        ? computeMargin(
            {
              sku,
              quantityMt: qty,
              pricePerKg: l.pricePerKg,
              currency: input.currency,
              beanOrigin: input.beanOrigin,
              gbClosedPrice: input.gbPriceClosed ? input.gbClosedPrice : null,
              freightBasis: input.freightBasis,
              advancePct: input.advancePct,
              creditDays: input.creditDays,
            },
            s,
          )
        : null;

    let materialWarning: string | null = null;
    if (sku && l.month && input.beanOrigin) {
      const m = earliestMaterialMonth(sku, input.beanOrigin, s, materialsOrderedOn);
      if (l.month < m.month) materialWarning = `${m.binding} ordered now arrives by ${formatDate(m.arrival)}, too late for ${monthLabel(l.month)} unless already in stock.`;
    }

    if (spill > 0) issues.push({ kind: "OVERBOOK", severity: "error", message: `${monthLabel(l.month)}: ${line?.code} is full, ${spill.toFixed(1)} tonnes over.` });
    if (materialWarning) issues.push({ kind: "MATERIAL", severity: "warning", message: `${monthLabel(l.month)}: ${materialWarning}` });

    return {
      index,
      sku,
      lineCode: line?.code ?? "",
      lineValid,
      lineError,
      capacity,
      bookedOthers,
      thisOrderBefore,
      free,
      after,
      spill,
      margin,
      belowMin: !!margin && margin.marginPct < s["margin.target_pct"],
      materialWarning,
      value: margin?.revenue ?? 0,
    };
  });

  const byIndex: Record<number, MarginResult> = {};
  lines.forEach((l) => {
    if (l.margin) byIndex[l.index] = l.margin;
  });
  const margin = rollUp(byIndex, s["margin.target_pct"]);
  if (input.creditDays > s["approval.cfo_credit_days"]) {
    issues.push({ kind: "PACK", severity: "warning", message: `${input.creditDays}-day credit is longer than the ${s["approval.cfo_credit_days"]}-day norm.` });
  }
  return { lines, margin, issues, settings: s };
}

export function submitErrors(input: OrderInput, ev: ReturnType<typeof evaluateOrder>): Record<string, string> {
  const e: Record<string, string> = {};
  if (!input.customerId && !input.newCustomerName.trim()) e.customer = "Pick or add a customer";
  if (!input.contactPerson.trim()) e.contactPerson = "Contact person is required";
  if (!input.bdOwnerId) e.bdOwnerId = "Assign a BD owner";
  if (!input.destinationCountry.trim()) e.destinationCountry = "Destination country is required";
  if (!input.destinationPort.trim()) e.destinationPort = "Destination port is required";
  if (!input.incoterm) e.incoterm = "Pick an Incoterm";
  if (!input.freightBasis) e.freightBasis = "Pick a freight basis";
  if (!input.gbGrade) e.gbGrade = "Pick the green bean grade";
  if (!input.beanOrigin) e.beanOrigin = "Pick a preferred origin";
  if (input.gbPriceClosed && !(Number(input.gbClosedPrice) > 0)) e.gbClosedPrice = "Enter the closed GB price";
  if (!input.paymentMode) e.paymentMode = "Pick LC or open account";
  if (!(input.advancePct >= 0 && input.advancePct <= 100)) e.advancePct = "Advance must be 0–100%";
  if (!(input.creditDays >= 0)) e.creditDays = "Credit days must be 0 or more";
  if (!input.lines.length) e.lines = "Add at least one order line";
  input.lines.forEach((l, i) => {
    const ev1 = ev.lines[i];
    const p = `line.${i}`;
    if (!ev1.sku) e[`${p}.skuId`] = "Pick a product";
    if (!l.month || l.month < planningStart()) e[`${p}.month`] = `From ${monthLabel(planningStart())}`;
    if (!(l.quantityMt > 0)) e[`${p}.quantityMt`] = "Enter MT";
    if (!(l.pricePerKg > 0)) e[`${p}.pricePerKg`] = "Enter price";
    if (ev1.lineError) e[`${p}.lineId`] = ev1.lineError;
    if (ev1.sku?.blend === "CHICORY" && !(l.chicoryPct > 0)) e[`${p}.chicoryPct`] = "Chicory %";
  });
  const spills = ev.lines.filter((l) => l.spill > 0);
  if (spills.length && !input.spillOverride.trim()) {
    e.spillOverride = `${spills.length} line${spills.length > 1 ? "s" : ""} spill over capacity. Reduce quantity, change month or line, or give a reason to request a COO override.`;
  }
  return e;
}

// ---------- Saving, submitting and revisions ----------

function lineSummary(l: Pick<OrderLine, "skuId" | "month" | "quantityMt" | "pricePerKg" | "lineId" | "chicoryPct">) {
  const st = store();
  const sku = st.skus.find((s) => s.id === l.skuId)?.code ?? "?";
  const line = st.lines.find((x) => x.id === l.lineId)?.code ?? "?";
  return `${sku}${l.chicoryPct ? ` (${l.chicoryPct}% chicory)` : ""} · ${l.month ? monthLabel(l.month) : "?"} · ${l.quantityMt} MT @ ${l.pricePerKg.toLocaleString("en-IN")} · ${line}`;
}

function diffOrder(order: Order, oldLines: OrderLine[], input: OrderInput) {
  const changes: string[] = [];
  let key = false;
  const fields: [keyof OrderInput & keyof Order, string][] = [
    ["contactPerson", "Contact person"],
    ["customerType", "New/repeat"],
    ["bdOwnerId", "BD owner"],
    ["destinationCountry", "Destination country"],
    ["destinationPort", "Destination port"],
    ["incoterm", "Incoterm"],
    ["freightBasis", "Freight basis"],
    ["gbGrade", "GB grade"],
    ["beanOrigin", "Origin"],
    ["advancePct", "Advance %"],
    ["creditDays", "Credit days"],
    ["paymentMode", "LC / open account"],
    ["currency", "Currency"],
    ["specNotes", "Spec notes"],
  ];
  for (const [f, label] of fields) if (String(order[f]) !== String(input[f])) changes.push(`${label}: ${order[f] || "–"} → ${input[f] || "–"}`);
  const oldGb = order.gbPriceClosed ? order.gbClosedPrice : null;
  const newGb = input.gbPriceClosed ? input.gbClosedPrice : null;
  if (oldGb !== newGb) {
    changes.push(`GB price: ${oldGb ? `closed @ ₹${oldGb}` : "open"} → ${newGb ? `closed @ ₹${newGb}` : "open"}`);
    key = true;
  }
  const oldById = new Map(oldLines.map((l) => [l.id, l]));
  const kept = new Set<number>();
  input.lines.forEach((l, i) => {
    const prev = l.id ? oldById.get(l.id) : undefined;
    if (!prev) {
      changes.push(`Line ${i + 1} added: ${lineSummary(l)}`);
      key = true;
      return;
    }
    kept.add(prev.id);
    if (prev.skuId !== l.skuId || prev.month !== l.month || prev.quantityMt !== l.quantityMt || prev.pricePerKg !== l.pricePerKg || prev.lineId !== l.lineId || prev.chicoryPct !== l.chicoryPct) {
      changes.push(`Line ${i + 1}: ${lineSummary(prev)} → ${lineSummary(l)}`);
      key = true;
    }
  });
  for (const l of oldLines) {
    if (!kept.has(l.id)) {
      changes.push(`Line removed: ${lineSummary(l)}`);
      key = true;
    }
  }
  return { changes, key };
}

function writeLines(orderId: number, lines: LineInput[]) {
  const st = store();
  st.orderLines = st.orderLines.filter((l) => l.orderId !== orderId);
  for (const l of lines) {
    const sku = st.skus.find((s) => s.id === l.skuId);
    st.orderLines.push({
      id: l.id ?? nextId("orderLines"),
      orderId,
      skuId: l.skuId,
      chicoryPct: sku?.blend === "CHICORY" ? l.chicoryPct : 0,
      month: l.month,
      quantityMt: l.quantityMt,
      pricePerKg: l.pricePerKg,
      lineId: l.lineId,
    });
  }
}

function headerFrom(input: OrderInput, customerId: number) {
  return {
    customerId,
    contactPerson: input.contactPerson,
    customerType: input.customerType,
    bdOwnerId: input.bdOwnerId,
    destinationCountry: input.destinationCountry,
    destinationPort: input.destinationPort,
    incoterm: input.incoterm,
    freightBasis: input.freightBasis,
    gbGrade: input.gbGrade,
    beanOrigin: input.beanOrigin,
    gbPriceClosed: input.gbPriceClosed,
    gbClosedPrice: input.gbPriceClosed ? input.gbClosedPrice : null,
    advancePct: input.advancePct,
    creditDays: input.creditDays,
    paymentMode: input.paymentMode,
    currency: input.currency,
    specNotes: input.specNotes,
    spillOverride: input.spillOverride,
  };
}

function resolveCustomer(input: OrderInput): number {
  const st = store();
  if (input.customerId) return input.customerId;
  const name = input.newCustomerName.trim();
  if (!name) return 0;
  const existing = st.customers.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const id = nextId("customers");
  st.customers.push({ id, name, country: input.customerCountry || input.destinationCountry, contactPerson: input.contactPerson, bdOwnerId: input.bdOwnerId });
  return id;
}

// Soft-holds capacity, snapshots margin and cost norms, and opens parallel CFO + COO reviews.
function sendForApproval(order: Order, viewer: Viewer, materialsOrderedOn?: string, note = "Submitted") {
  const st = store();
  const lines = st.orderLines.filter((l) => l.orderId === order.id);
  const ev = evaluateOrder({ ...order, lines }, order.id, materialsOrderedOn);
  const byLine: Record<number, MarginResult> = {};
  lines.forEach((l, i) => {
    if (ev.lines[i].margin) byLine[l.id] = ev.lines[i].margin!;
  });
  const snapshot: OrderMargin & { norms: Settings } = { ...rollUp(byLine, ev.settings["margin.target_pct"]), norms: ev.settings };

  st.allocations = st.allocations.filter((a) => a.orderId !== order.id);
  for (const l of lines) st.allocations.push({ id: nextId("allocations"), orderId: order.id, orderLineId: l.id, lineId: l.lineId, month: l.month, quantityMt: l.quantityMt });
  st.approvals = st.approvals.filter((a) => a.orderId !== order.id);
  for (const role of ["CFO", "COO"] as const) {
    st.approvals.push({ id: nextId("approvals"), orderId: order.id, role, focus: APPROVER_FOCUS[role], status: "PENDING", comment: "", decidedAt: null, decidedBy: null });
  }
  Object.assign(order, { status: "PENDING_APPROVAL", submittedAt: new Date(), decidedAt: null, marginSnapshot: snapshot, issues: ev.issues });
  audit(
    viewer,
    "SUBMITTED",
    order.id,
    `${note} for CFO + COO approval, ${lines.length} line${lines.length > 1 ? "s" : ""}, margin ${snapshot.marginPct.toFixed(1)}%${order.spillOverride ? `; COO spill override requested: ${order.spillOverride}` : ""}`,
  );
}

export function saveOrder(input: OrderInput, viewer: Viewer, intent: "draft" | "submit", orderId?: number, materialsOrderedOn?: string) {
  return transaction(() => {
    const st = store();
    if (intent === "submit") {
      const errs = submitErrors(input, evaluateOrder(input, orderId, materialsOrderedOn));
      if (Object.keys(errs).length) throw new ValidationError(errs);
    }

    if (!orderId) {
      if (!can(viewer.role, ["BD_EXEC", "BD_HEAD"])) throw new WorkflowError("Only BD can create orders");
      const customerId = resolveCustomer(input);
      if (!customerId) throw new ValidationError({ customer: "Pick or add a customer" });
      const id = nextId("orders");
      const order: Order = {
        id,
        ref: `SLN-SO-${String(id).padStart(4, "0")}`,
        status: "DRAFT",
        version: 1,
        priority: "NORMAL",
        ...headerFrom(input, customerId),
        marginSnapshot: null,
        issues: null,
        createdAt: new Date(),
        submittedAt: null,
        decidedAt: null,
      };
      st.orders.push(order);
      writeLines(id, input.lines);
      st.revisions.push({ id: nextId("revisions"), orderId: id, version: 1, at: new Date(), by: actor(viewer, "BD_EXEC", id).name, changes: ["Order created"], reapproval: false });
      audit(viewer, "CREATED", id, `Draft created for ${st.customers.find((c) => c.id === customerId)?.name}`);
      if (intent === "submit") sendForApproval(order, viewer, materialsOrderedOn);
      return id;
    }

    const order = findOrder(orderId);
    if (!canEditOrder(viewer, order)) throw new WorkflowError("You can't edit this order");
    const oldLines = st.orderLines.filter((l) => l.orderId === orderId);
    const { changes, key } = diffOrder(order, oldLines, input);
    const wasLive = order.status === "PENDING_APPROVAL" || order.status === "COMMITTED";
    const wasSentBack = order.status === "SENT_BACK";
    Object.assign(order, headerFrom(input, resolveCustomer(input) || order.customerId));
    writeLines(orderId, input.lines);

    const reapproval = wasLive && key;
    if (changes.length) {
      order.version += 1;
      st.revisions.push({ id: nextId("revisions"), orderId, version: order.version, at: new Date(), by: actor(viewer, "BD_EXEC", orderId).name, changes, reapproval });
      audit(viewer, "EDITED", orderId, `v${order.version}: ${changes.length} change${changes.length > 1 ? "s" : ""}${reapproval ? ", goes back for re-approval" : ""}`);
    }

    if (reapproval) sendForApproval(order, viewer, undefined, "Changed after review; resubmitted");
    else if (intent === "submit" && order.status !== "PENDING_APPROVAL" && order.status !== "COMMITTED") sendForApproval(order, viewer, undefined, wasSentBack ? "Resubmitted" : "Submitted");
    else if (wasLive) order.issues = evaluateOrder({ ...order, lines: st.orderLines.filter((l) => l.orderId === orderId) }, orderId).issues;
    return orderId;
  });
}

// ---------- Approvals: CFO and COO in parallel ----------

export function decide(orderId: number, role: ApproverRole, decision: "APPROVED" | "REJECTED" | "SENT_BACK", comment: string, viewer: Viewer) {
  return transaction(() => {
    const st = store();
    const order = findOrder(orderId);
    if (order.status !== "PENDING_APPROVAL") throw new WorkflowError("Order is not awaiting approval");
    if (!can(viewer.role, [role])) throw new WorkflowError(`Only the ${role} can decide this review`);
    const approval = st.approvals.find((a) => a.orderId === orderId && a.role === role);
    if (!approval || approval.status !== "PENDING") throw new WorkflowError(`${role} has already decided on this order`);
    if (decision !== "APPROVED" && !comment.trim()) throw new WorkflowError("Add a comment so BD knows what to change");

    Object.assign(approval, { status: decision, comment, decidedAt: new Date(), decidedBy: actor(viewer, role).name });
    const label = decision === "APPROVED" ? "Approved" : decision === "REJECTED" ? "Rejected" : "Sent back";
    audit(viewer, decision, orderId, `${role}: ${label}${comment ? `, ${comment}` : ""}`, role);

    if (decision === "REJECTED") {
      st.allocations = st.allocations.filter((a) => a.orderId !== orderId);
      Object.assign(order, { status: "REJECTED", decidedAt: new Date() });
      return "REJECTED";
    }
    if (decision === "SENT_BACK") {
      Object.assign(order, { status: "SENT_BACK", decidedAt: new Date() });
      return "SENT_BACK";
    }
    if (st.approvals.filter((a) => a.orderId === orderId).every((a) => a.status === "APPROVED")) {
      Object.assign(order, { status: "COMMITTED", decidedAt: new Date() });
      audit(viewer, "COMMITTED", orderId, "CFO and COO both approved, capacity committed and added to the procurement sheet");
      return "COMMITTED";
    }
    return "PENDING_APPROVAL";
  });
}

export function cancelOrder(orderId: number, reason: string, viewer: Viewer) {
  return transaction(() => {
    const st = store();
    const order = findOrder(orderId);
    if (!canEditOrder(viewer, order)) throw new WorkflowError("You can't cancel this order");
    if (!reason.trim()) throw new WorkflowError("Give a reason for cancelling");
    st.allocations = st.allocations.filter((a) => a.orderId !== orderId);
    Object.assign(order, { status: "CANCELLED", decidedAt: new Date() });
    audit(viewer, "CANCELLED", orderId, `Cancelled, ${reason}. Capacity released.`);
  });
}

export function reassignOrder(orderId: number, bdOwnerId: number, priority: "NORMAL" | "HIGH", viewer: Viewer) {
  if (!can(viewer.role, ["BD_HEAD"])) throw new WorkflowError("Only the BD head can reassign orders");
  const st = store();
  const order = findOrder(orderId);
  const owner = st.users.find((u) => u.id === bdOwnerId);
  if (!owner) throw new WorkflowError("Unknown BD owner");
  const changes: string[] = [];
  if (order.bdOwnerId !== bdOwnerId) changes.push(`BD owner → ${owner.name}`);
  if (order.priority !== priority) changes.push(`Priority → ${priority === "HIGH" ? "High" : "Normal"}`);
  if (!changes.length) return;
  Object.assign(order, { bdOwnerId, priority });
  audit(viewer, "REASSIGNED", orderId, changes.join("; "));
}

// ---------- Procurement ----------

export function setGbClosure(orderId: number, closed: boolean, price: number | null, viewer: Viewer) {
  return transaction(() => {
    if (!can(viewer.role, ["PROCUREMENT", "COO"])) throw new WorkflowError("Only procurement or the COO can close GB prices");
    const order = findOrder(orderId);
    if (closed && !(Number(price) > 0)) throw new WorkflowError("Enter the closed price");
    const newPrice = closed ? Number(price) : null;
    const oldPrice = order.gbPriceClosed ? order.gbClosedPrice : null;
    if (newPrice === oldPrice) return;
    Object.assign(order, { gbPriceClosed: closed, gbClosedPrice: newPrice });
    const change = `GB price: ${oldPrice ? `closed @ ₹${oldPrice}` : "open"} → ${newPrice ? `closed @ ₹${newPrice}` : "open"}`;
    const live = order.status === "COMMITTED" || order.status === "PENDING_APPROVAL";
    order.version += 1;
    store().revisions.push({ id: nextId("revisions"), orderId, version: order.version, at: new Date(), by: actor(viewer, "PROCUREMENT").name, changes: [change], reapproval: live });
    audit(viewer, "GB_CLOSURE", orderId, change);
    if (live) sendForApproval(order, viewer, undefined, "GB price changed; resubmitted");
  });
}

// ---------- Production plan moves (COO) ----------

export type MoveRequest = { allocationId: number; lineId: number; month: string; quantityMt: number };

export function simulateMove(req: MoveRequest) {
  const st = store();
  const alloc = st.allocations.find((a) => a.id === req.allocationId);
  if (!alloc) throw new WorkflowError("Production slot not found");
  const order = findOrder(alloc.orderId);
  const ol = st.orderLines.find((l) => l.id === alloc.orderLineId);
  if (!ol) throw new WorkflowError("Order line not found");
  const sku = withShare(skuOf(ol.skuId)!, ol.chicoryPct);
  const pt = sku.productType;
  const s = loadSettings();
  const state = loadCapacityState();
  const target = state.lines.find((l) => l.id === req.lineId);
  const source = state.lines.find((l) => l.id === alloc.lineId);
  if (!target || !source) throw new WorkflowError("Line not found");

  const qty = Math.min(Math.max(req.quantityMt, 0), alloc.quantityMt);
  const sameCell = target.id === source.id && req.month === alloc.month;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!target.productTypes.includes(pt)) errors.push(`${target.code} can't make ${(PRODUCT_TYPES[pt as keyof typeof PRODUCT_TYPES] ?? pt).toLowerCase()}.`);
  if (req.month < planningStart()) errors.push(`Production can only be planned from ${monthLabel(planningStart())} onward.`);
  if (qty <= 0) errors.push("Quantity to move must be greater than zero.");
  if (sameCell) errors.push("Choose a different line or month.");
  if (req.month > ol.month) warnings.push(`Production after ${monthLabel(ol.month)} misses this line's delivery month.`);

  const srcBefore = loadAt(state, source.id, alloc.month);
  const tgtBefore = loadAt(state, target.id, req.month);
  const tgtCap = capacityAt(state, target.id, req.month);
  const cells = {
    source: { line: source.code, month: alloc.month, capacity: capacityAt(state, source.id, alloc.month), before: srcBefore, after: srcBefore - qty },
    target: { line: target.code, month: req.month, capacity: tgtCap, before: tgtBefore, after: tgtBefore + qty },
  };
  if (cells.target.after > tgtCap + 0.05) warnings.push(`${target.code} would be over by ${(cells.target.after - tgtCap).toFixed(1)} tonnes in ${monthLabel(req.month)}.`);

  const packCap = s[`pack_capacity.${sku.packFormat}`];
  if (packCap !== undefined && req.month !== alloc.month) {
    const after = packLoadAt(state, sku.packFormat, req.month) + qty;
    if (after > packCap + 0.05) warnings.push(`${sku.packFormat === "GLASS" ? "Glass" : "Can"} filling would need ${after.toFixed(1)} MT in ${monthLabel(req.month)} against ${packCap} MT.`);
  }

  // Materials: does stock + purchases on the way cover this quantity in the new month?
  const procurement: { material: string; oldOrderBy: string; newOrderBy: string; late: boolean }[] = [];
  if (req.month !== alloc.month && qty > 0) {
    const projection = inventoryProjection();
    for (const d of requirementsFor(sku, order, { month: req.month, quantityMt: qty }, s)) {
      const cell = projection.find((r) => r.key === d.key)?.cells[req.month];
      const room = cell ? Math.max(0, cell.available - cell.need) : 0;
      const short = Math.max(0, d.quantity - room);
      procurement.push({ material: d.material, oldOrderBy: "", newOrderBy: d.orderBy, late: short > 0.5 });
      if (short > 0.5) warnings.push(`${d.material}: ${d.unit === "kg" ? `${(short / 1000).toFixed(1)} t` : `${Math.round(short).toLocaleString("en-IN")} ${d.unit}`} missing in ${monthLabel(req.month)}, procurement would need to buy.`);
    }
  }

  const customer = st.customers.find((c) => c.id === order.customerId)?.name ?? "";
  return { order: { id: order.id, ref: order.ref, customer, status: order.status }, sku: sku.code, quantityMt: qty, cells, errors, warnings, procurement };
}

export type MoveSimulation = ReturnType<typeof simulateMove>;

export function applyMove(req: MoveRequest, viewer: Viewer) {
  if (!can(viewer.role, ["COO", "PLANNER"])) throw new WorkflowError("Only the COO or production planner can change the plan");
  return transaction(() => {
    const st = store();
    const sim = simulateMove(req);
    if (sim.errors.length) throw new WorkflowError(sim.errors.join(" "));
    const alloc = st.allocations.find((a) => a.id === req.allocationId)!;
    const qty = sim.quantityMt;
    const remaining = alloc.quantityMt - qty;
    const merge = st.allocations.find((a) => a.orderLineId === alloc.orderLineId && a.lineId === req.lineId && a.month === req.month);
    if (merge) merge.quantityMt += qty;
    else if (remaining <= 0.05) Object.assign(alloc, { lineId: req.lineId, month: req.month });
    else st.allocations.push({ id: nextId("allocations"), orderId: alloc.orderId, orderLineId: alloc.orderLineId, lineId: req.lineId, month: req.month, quantityMt: qty });
    if (merge && remaining <= 0.05) st.allocations = st.allocations.filter((a) => a.id !== alloc.id);
    else if (remaining > 0.05) alloc.quantityMt = remaining;
    audit(
      viewer,
      "PLAN_CHANGED",
      alloc.orderId,
      `Moved ${qty.toFixed(1)} MT from ${sim.cells.source.line} ${monthLabel(sim.cells.source.month)} to ${sim.cells.target.line} ${monthLabel(sim.cells.target.month)}${sim.warnings.length ? ` (accepted: ${sim.warnings.join(" ")})` : ""}`,
    );
  });
}

// ---------- Production calendar edits (planner / COO) ----------

const PLANNERS: Role[] = ["COO", "PLANNER"];

export function setMonthCapacity(lineId: number, month: string, capacityMt: number, note: string, viewer: Viewer) {
  if (!can(viewer.role, PLANNERS)) throw new WorkflowError("Only the COO or production planner can change capacity");
  if (!(capacityMt >= 0)) throw new WorkflowError("Capacity must be 0 or more");
  const st = store();
  const line = st.lines.find((l) => l.id === lineId);
  if (!line) throw new WorkflowError("Line not found");
  st.capacityOverrides = st.capacityOverrides.filter((o) => !(o.lineId === lineId && o.month === month));
  if (capacityMt !== line.capacityMt || note.trim()) st.capacityOverrides.push({ lineId, month, capacityMt, note: note.trim() });
  audit(viewer, "CAPACITY", null, `${line.code} ${monthLabel(month)}: max ${capacityMt} tonnes${note.trim() ? ` (${note.trim()})` : ""}`);
}

export function addReservation(lineId: number, month: string, quantityMt: number, label: string, productType: string, viewer: Viewer) {
  if (!can(viewer.role, PLANNERS)) throw new WorkflowError("Only the COO or production planner can reserve time");
  if (!(quantityMt > 0)) throw new WorkflowError("Enter the tonnes to reserve");
  if (!label.trim()) throw new WorkflowError("Say what the time is reserved for");
  const st = store();
  const line = st.lines.find((l) => l.id === lineId);
  if (!line) throw new WorkflowError("Line not found");
  if (!st.lineProducts.some((p) => p.lineId === lineId && p.productType === productType)) throw new WorkflowError(`${line.code} can't make that product`);
  st.reservations.push({ id: nextId("reservations"), lineId, month, quantityMt, label: label.trim(), productType, createdBy: actor(viewer, "PLANNER").name });
  audit(viewer, "RESERVED", null, `${line.code} ${monthLabel(month)}: ${quantityMt} tonnes reserved for ${label.trim()}`);
}

// Short slot: keep what was made in this month and move the rest to the same line next month.
export function carryOverShort(allocationId: number, viewer: Viewer) {
  if (!can(viewer.role, PLANNERS)) throw new WorkflowError("Only the COO or production planner can move production");
  return transaction(() => {
    const st = store();
    const a = st.allocations.find((x) => x.id === allocationId);
    if (!a) throw new WorkflowError("Production slot not found");
    const made = a.producedMt ?? 0;
    const short = Math.round((a.quantityMt - made) * 10) / 10;
    if (short <= 0.05) throw new WorkflowError("Nothing short on this slot");
    const next = addMonthsLocal(a.month, 1);
    const merge = st.allocations.find((x) => x.orderLineId === a.orderLineId && x.lineId === a.lineId && x.month === next);
    if (merge) merge.quantityMt = Math.round((merge.quantityMt + short) * 10) / 10;
    else st.allocations.push({ id: nextId("allocations"), orderId: a.orderId, orderLineId: a.orderLineId, lineId: a.lineId, month: next, quantityMt: short });
    a.quantityMt = made;
    const line = st.lines.find((l) => l.id === a.lineId)?.code ?? "";
    audit(viewer, "CARRY_OVER", a.orderId, `${line}: ${short} t not made in ${monthLabel(a.month)} moved to ${monthLabel(next)}`);
  });
}

// ---------- Daily production log ----------

function dayLog(id: number) {
  const d = store().dayLogs.find((x) => x.id === id);
  if (!d) throw new WorkflowError("Day not found");
  return d;
}

export function startDay(lineId: number, date: string, allocationId: number | null, capacityT: number, viewer: Viewer) {
  if (!can(viewer.role, PLANNERS)) throw new WorkflowError("Only the COO or production planner can start a line");
  if (!(capacityT >= 0)) throw new WorkflowError("Capacity must be 0 or more");
  const st = store();
  if (st.dayLogs.some((d) => d.lineId === lineId && d.date === date)) throw new WorkflowError("This line is already locked for the day");
  st.dayLogs.push({ id: nextId("dayLogs"), lineId, date, allocationId, capacityT, lockedAt: new Date(), lockedBy: actor(viewer, "PLANNER").name, events: [{ at: new Date(), by: actor(viewer, "PLANNER").name, capacityT, reason: "Day started" }], madeT: null, closedAt: null });
  const line = st.lines.find((l) => l.id === lineId)?.code ?? "";
  const orderId = allocationId ? (st.allocations.find((a) => a.id === allocationId)?.orderId ?? null) : null;
  audit(viewer, "DAY_LOCKED", orderId, `${line} ${date}: started at ${capacityT} t/day`);
}

export function changeDayCapacity(id: number, capacityT: number, reason: string, viewer: Viewer) {
  if (!can(viewer.role, PLANNERS)) throw new WorkflowError("Only the COO or production planner can change capacity");
  if (!(capacityT >= 0)) throw new WorkflowError("Capacity must be 0 or more");
  if (!reason.trim()) throw new WorkflowError("Say why the capacity changed");
  const d = dayLog(id);
  if (d.closedAt) throw new WorkflowError("This day is already closed");
  d.events.push({ at: new Date(), by: actor(viewer, "PLANNER").name, capacityT, reason: reason.trim() });
  const line = store().lines.find((l) => l.id === d.lineId)?.code ?? "";
  audit(viewer, "DAY_CAPACITY", null, `${line} ${d.date}: ${d.capacityT} to ${capacityT} t/day (${reason.trim()})`);
  d.capacityT = capacityT;
}

// Whole day off for one line (shutdown, no power, holiday). Capacity 0, nothing made.
export function markNotRunning(lineId: number, date: string, reason: string, viewer: Viewer) {
  if (!can(viewer.role, PLANNERS)) throw new WorkflowError("Only the COO or production planner can stop a line");
  if (!reason.trim()) throw new WorkflowError("Say why the line is not running");
  const st = store();
  const existing = st.dayLogs.find((d) => d.lineId === lineId && d.date === date);
  const line = st.lines.find((l) => l.id === lineId)?.code ?? "";
  if (existing) {
    const a = existing.allocationId ? st.allocations.find((x) => x.id === existing.allocationId) : null;
    if (a && existing.madeT) a.producedMt = Math.max(0, Math.round(((a.producedMt ?? 0) - existing.madeT) * 10) / 10);
    existing.events.push({ at: new Date(), by: actor(viewer, "PLANNER").name, capacityT: 0, reason: `Not running: ${reason.trim()}` });
    Object.assign(existing, { capacityT: 0, madeT: 0, closedAt: new Date(), stopped: true });
  } else {
    st.dayLogs.push({ id: nextId("dayLogs"), lineId, date, allocationId: null, capacityT: 0, lockedAt: new Date(), lockedBy: actor(viewer, "PLANNER").name, events: [{ at: new Date(), by: actor(viewer, "PLANNER").name, capacityT: 0, reason: `Not running: ${reason.trim()}` }], madeT: 0, closedAt: new Date(), stopped: true });
  }
  audit(viewer, "DAY_STOPPED", null, `${line} ${date}: not running (${reason.trim()})`);
}

export function resumeDay(id: number, viewer: Viewer) {
  if (!can(viewer.role, PLANNERS)) throw new WorkflowError("Only the COO or production planner can change this");
  const st = store();
  const d = dayLog(id);
  if (!d.stopped) throw new WorkflowError("This day is not marked as not running");
  st.dayLogs = st.dayLogs.filter((x) => x.id !== id);
  const line = st.lines.find((l) => l.id === d.lineId)?.code ?? "";
  audit(viewer, "DAY_RESUMED", null, `${line} ${d.date}: back to a normal day`);
}

export function closeDay(id: number, madeT: number, viewer: Viewer, reason = "") {
  if (!can(viewer.role, PLANNERS)) throw new WorkflowError("Only the COO or production planner can close a day");
  if (!(madeT >= 0)) throw new WorkflowError("Enter the tonnes made");
  const st = store();
  const d = dayLog(id);
  const delta = madeT - (d.madeT ?? 0);
  d.madeT = Math.round(madeT * 10) / 10;
  d.closedAt = new Date();
  if (reason.trim()) d.events.push({ at: new Date(), by: actor(viewer, "PLANNER").name, capacityT: d.madeT, reason: reason.trim() });
  // Daily output rolls up into the month's "made" for the slot that was running.
  const a = d.allocationId ? st.allocations.find((x) => x.id === d.allocationId) : null;
  if (a) {
    a.producedMt = Math.max(0, Math.round(((a.producedMt ?? 0) + delta) * 10) / 10);
    a.producedAt = new Date();
  }
  const line = st.lines.find((l) => l.id === d.lineId)?.code ?? "";
  audit(viewer, "DAY_CLOSED", a?.orderId ?? null, `${line} ${d.date}: made ${d.madeT} t${reason.trim() ? ` (${reason.trim()})` : ""}`);
}

// Execution: the planner records how many tonnes were actually made for a planned slot.
export function recordProduction(allocationId: number, producedMt: number, note: string, viewer: Viewer) {
  if (!can(viewer.role, PLANNERS)) throw new WorkflowError("Only the COO or production planner can record production");
  const st = store();
  const a = st.allocations.find((x) => x.id === allocationId);
  if (!a) throw new WorkflowError("Production slot not found");
  const order = st.orders.find((o) => o.id === a.orderId);
  if (order?.status !== "COMMITTED") throw new WorkflowError("Only approved orders go into production");
  if (!(producedMt >= 0) || producedMt > a.quantityMt * 1.2) throw new WorkflowError(`Enter 0 to ${(a.quantityMt * 1.2).toFixed(1)} tonnes`);
  const before = a.producedMt ?? 0;
  Object.assign(a, { producedMt: Math.round(producedMt * 10) / 10, producedAt: new Date(), productionNote: note.trim() });
  const line = st.lines.find((l) => l.id === a.lineId)?.code ?? "";
  audit(viewer, "PRODUCED", a.orderId, `${line} ${monthLabel(a.month)}: made ${producedMt} of ${a.quantityMt} t (was ${before} t)${note.trim() ? `. ${note.trim()}` : ""}`);
}

export function removeReservation(id: number, viewer: Viewer) {
  if (!can(viewer.role, PLANNERS)) throw new WorkflowError("Only the COO or production planner can release reserved time");
  const st = store();
  st.reservations = st.reservations.filter((r) => r.id !== id);
  audit(viewer, "RELEASED", null, `Reserved time #${id} released`);
}

export function setLineSetup(lineId: number, setup: { capacityMt: number; productTypes: string[]; active: boolean; capacityConfirmed: boolean; runDays?: number[]; productCaps?: Record<string, number> }, viewer: Viewer) {
  if (!can(viewer.role, ["COO", "ADMIN"])) throw new WorkflowError("Only the COO or admin can change line setup");
  const st = store();
  const line = st.lines.find((l) => l.id === lineId);
  if (!line) throw new WorkflowError("Line not found");
  if (!setup.productTypes.length) throw new WorkflowError("A line must make at least one product");
  const state = loadCapacityState();
  const dropped = state.rows.find((r) => r.lineId === lineId && !setup.productTypes.includes(r.productType));
  if (dropped) throw new WorkflowError(`${line.code} still has ${PRODUCT_TYPES[dropped.productType as keyof typeof PRODUCT_TYPES]} planned for ${dropped.orderRef}. Move it first.`);
  if (setup.runDays && !setup.runDays.length) throw new WorkflowError("A line must run at least one day a week");
  Object.assign(line, { capacityMt: setup.capacityMt, active: setup.active, capacityConfirmed: setup.capacityConfirmed, ...(setup.runDays ? { runDays: [...setup.runDays].sort() } : {}) });
  const caps = setup.productCaps;
  st.lineProducts = [...st.lineProducts.filter((p) => p.lineId !== lineId), ...setup.productTypes.map((productType) => ({ lineId, productType, ...(caps ? { capacityMt: caps[productType] ?? 0 } : {}) }))];
  audit(viewer, "LINE_SETUP", null, `${line.code}: ${setup.capacityMt} tonnes/month, makes ${setup.productTypes.map((p) => PRODUCT_TYPES[p as keyof typeof PRODUCT_TYPES]).join(" & ")}${setup.active ? "" : " (switched off)"}`);
}

// ---------- Inventory & purchasing ----------

export function raisePurchaseRequest(materialKey: string, quantity: number, neededBy: string, note: string, viewer: Viewer) {
  if (!can(viewer.role, ["COO", "PLANNER", "PROCUREMENT"])) throw new WorkflowError("Only planning or procurement can ask for materials");
  if (!(quantity > 0)) throw new WorkflowError("Enter a quantity");
  const st = store();
  const open = st.purchaseRequests.find((r) => r.materialKey === materialKey && r.neededBy === neededBy && r.status === "OPEN");
  if (open) {
    open.quantity = Math.max(open.quantity, quantity);
    return open.id;
  }
  const id = nextId("purchaseRequests");
  st.purchaseRequests.push({ id, materialKey, quantity, neededBy, note: note.trim(), status: "OPEN", raisedBy: actor(viewer, "PLANNER").name, createdAt: new Date(), poId: null });
  audit(viewer, "REQUESTED", null, `Asked procurement for ${materialKey} by ${monthLabel(neededBy)}`);
  return id;
}

export function createPurchaseOrder(materialKey: string, quantity: number, arrivalMonth: string, supplier: string, requestId: number | null, viewer: Viewer) {
  if (!can(viewer.role, ["PROCUREMENT", "COO"])) throw new WorkflowError("Only procurement or the COO can place purchase orders");
  if (!(quantity > 0)) throw new WorkflowError("Enter a quantity");
  if (!supplier.trim()) throw new WorkflowError("Enter the supplier");
  const st = store();
  if (!st.inventory.some((i) => i.key === materialKey)) st.inventory.push({ key: materialKey, ...describeMaterial(materialKey), onHand: 0 });
  const id = nextId("purchaseOrders");
  st.purchaseOrders.push({ id, materialKey, quantity, arrivalMonth, supplier: supplier.trim(), status: "ORDERED", createdBy: actor(viewer, "PROCUREMENT").name, createdAt: new Date(), requestId });
  const req = requestId ? st.purchaseRequests.find((r) => r.id === requestId) : undefined;
  if (req) Object.assign(req, { status: "ORDERED", poId: id });
  audit(viewer, "PURCHASE_ORDER", null, `PO-${id}: ${materialKey} from ${supplier.trim()}, arriving ${monthLabel(arrivalMonth)}`);
  return id;
}

export function receivePurchaseOrder(poId: number, viewer: Viewer) {
  if (!can(viewer.role, ["PROCUREMENT", "COO"])) throw new WorkflowError("Only procurement or the COO can receive stock");
  const st = store();
  const po = st.purchaseOrders.find((p) => p.id === poId);
  if (!po || po.status !== "ORDERED") throw new WorkflowError("Purchase order not open");
  po.status = "RECEIVED";
  const item = st.inventory.find((i) => i.key === po.materialKey);
  if (item) item.onHand += po.quantity;
  audit(viewer, "RECEIVED", null, `PO-${po.id} received into stock`);
}

export function dismissRequest(id: number, viewer: Viewer) {
  if (!can(viewer.role, ["PROCUREMENT", "COO"])) throw new WorkflowError("Only procurement or the COO can close requests");
  const req = store().purchaseRequests.find((r) => r.id === id);
  if (req) req.status = "DISMISSED";
}

export function setStock(materialKey: string, onHand: number, viewer: Viewer) {
  if (!can(viewer.role, ["PROCUREMENT", "COO"])) throw new WorkflowError("Only procurement or the COO can correct stock");
  if (!(onHand >= 0)) throw new WorkflowError("Stock must be 0 or more");
  const item = store().inventory.find((i) => i.key === materialKey);
  if (!item) throw new WorkflowError("Unknown material");
  audit(viewer, "STOCK", null, `${item.name}: stock ${item.onHand} → ${onHand}`);
  item.onHand = onHand;
}
