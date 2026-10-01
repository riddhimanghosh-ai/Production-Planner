import { store } from "@/data/store";
import type { Approval, Customer, Order, OrderLine, Sku, User } from "@/data/types";
import { capacityAt, loadAt, loadCapacityState, type CapacityState, type Issue } from "./capacity";
import { monthLabel } from "./domain";
import { daysBetween, isoDate, todayIso } from "./domain";
import type { MarginResult, OrderMargin } from "./margin";
import { canSeeCommercials, evaluateOrder, type Viewer } from "./workflow";

export type OrderLineView = OrderLine & { sku: Sku; lineCode: string; margin: MarginResult | null };

export type OrderView = {
  order: Order;
  customer: Customer;
  owner: User | undefined;
  lines: OrderLineView[];
  approvals: Approval[];
  margin: OrderMargin;
  snapshot: (OrderMargin & { norms?: Record<string, number> }) | null;
  issues: Issue[];
  totalMt: number;
  firstMonth: string;
  lastMonth: string;
  commercials: boolean;
};

function buildView(order: Order, viewer: Viewer, state: CapacityState = loadCapacityState()): OrderView {
  const st = store();
  const rawLines = st.orderLines.filter((l) => l.orderId === order.id).sort((a, b) => a.month.localeCompare(b.month) || a.id - b.id);
  const snapshot = order.marginSnapshot as (OrderMargin & { norms?: Record<string, number> }) | null;
  const live = evaluateOrder({ ...order, lines: rawLines }, order.id);
  const lines: OrderLineView[] = rawLines.map((l, i) => ({
    ...l,
    sku: st.skus.find((s) => s.id === l.skuId)!,
    lineCode: st.lines.find((x) => x.id === l.lineId)?.code ?? "–",
    margin: snapshot?.byLine?.[l.id] ?? live.lines[i].margin,
  }));
  const months = lines.map((l) => l.month).sort();
  return {
    order,
    customer: st.customers.find((c) => c.id === order.customerId)!,
    owner: st.users.find((u) => u.id === order.bdOwnerId),
    lines,
    approvals: st.approvals.filter((a) => a.orderId === order.id).sort((a, b) => a.role.localeCompare(b.role)),
    margin: snapshot ?? live.margin,
    snapshot,
    issues: liveIssues(order, state, live.issues),
    totalMt: lines.reduce((a, l) => a + l.quantityMt, 0),
    firstMonth: months[0] ?? "",
    lastMonth: months.at(-1) ?? "",
    commercials: canSeeCommercials(viewer, order),
  };
}

export function listOrderViews(viewer: Viewer) {
  const state = loadCapacityState();
  return [...store().orders].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id).map((o) => buildView(o, viewer, state));
}

export function getOrderView(id: number, viewer: Viewer) {
  const st = store();
  const order = st.orders.find((o) => o.id === id);
  if (!order) return null;
  return {
    ...buildView(order, viewer),
    revisions: st.revisions.filter((r) => r.orderId === id).sort((a, b) => b.version - a.version || b.id - a.id),
    log: st.auditLog.filter((l) => l.orderId === id).sort((a, b) => b.at.getTime() - a.at.getTime() || b.id - a.id),
    allocations: st.allocations
      .filter((a) => a.orderId === id)
      .map((a) => ({ ...a, lineCode: st.lines.find((x) => x.id === a.lineId)?.code ?? "–" }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}

export function approvalQueue(viewer: Viewer) {
  const today = todayIso();
  return listOrderViews(viewer)
    .filter((v) => v.order.status === "PENDING_APPROVAL")
    .map((v) => ({
      ...v,
      waitingOn: v.approvals.filter((a) => a.status === "PENDING").map((a) => a.role),
      daysPending: v.order.submittedAt ? Math.max(0, daysBetween(isoDate(v.order.submittedAt), today)) : 0,
    }))
    .sort((a, b) => (a.order.submittedAt?.getTime() ?? 0) - (b.order.submittedAt?.getTime() ?? 0));
}

export function pendingSignoffCount(viewer: Viewer) {
  const st = store();
  const live = new Set(st.orders.filter((o) => o.status === "PENDING_APPROVAL").map((o) => o.id));
  return st.approvals.filter((a) => live.has(a.orderId) && a.status === "PENDING" && (viewer.role === "ALL" || a.role === viewer.role)).length;
}

export function users() {
  return [...store().users];
}

export function bdUsers() {
  return store().users.filter((u) => u.role === "BD_EXEC" || u.role === "BD_HEAD");
}

export function customers() {
  return [...store().customers].sort((a, b) => a.name.localeCompare(b.name));
}

export function activeSkus() {
  return store()
    .skus.filter((s) => s.active)
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function allSkus() {
  return [...store().skus].sort((a, b) => a.code.localeCompare(b.code));
}

export function settingsRows() {
  return [...store().settings].sort((a, b) => a.sort - b.sort);
}

export function recentActivity(limit = 8) {
  const st = store();
  return [...st.auditLog]
    .sort((a, b) => b.at.getTime() - a.at.getTime() || b.id - a.id)
    .slice(0, limit)
    .map((log) => ({ log, ref: log.orderId ? (st.orders.find((o) => o.id === log.orderId)?.ref ?? null) : null }));
}

// Where an order already holds line time, judge "full" from the calendar as it is now (after any planner moves).
function liveIssues(order: Order, state: CapacityState, draftIssues: Issue[]): Issue[] {
  const st = store();
  const allocs = st.allocations.filter((a) => a.orderId === order.id);
  if (!allocs.length) return (order.issues as Issue[] | null) ?? draftIssues;
  const lineCode = (id: number) => st.lines.find((l) => l.id === id)?.code ?? "";
  const cells = new Set(allocs.map((a) => `${a.lineId}|${a.month}`));
  const over: Issue[] = [...cells].flatMap((k) => {
    const [lineId, month] = [Number(k.split("|")[0]), k.split("|")[1]];
    const extra = loadAt(state, lineId, month) - capacityAt(state, lineId, month);
    return extra > 0.05 ? [{ kind: "OVERBOOK" as const, severity: "error" as const, message: `${monthLabel(month)}: ${lineCode(lineId)} is full, ${extra.toFixed(1)} tonnes over.` }] : [];
  });
  const others = ((order.issues as Issue[] | null) ?? []).filter((i) => i.kind !== "OVERBOOK");
  return [...over, ...others];
}
