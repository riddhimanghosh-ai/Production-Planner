import { seedStore } from "./seed";
import type {
  Allocation,
  Approval,
  AuditEntry,
  CapacityOverride,
  InventoryItem,
  PurchaseOrder,
  PurchaseRequest,
  Reservation,
  DayLog,
  PastSale,
  Customer,
  Line,
  LineProduct,
  Order,
  OrderLine,
  Revision,
  Setting,
  Sku,
  User,
} from "./types";

export type Store = {
  users: User[];
  customers: Customer[];
  lines: Line[];
  lineProducts: LineProduct[];
  capacityOverrides: CapacityOverride[];
  skus: Sku[];
  settings: Setting[];
  orders: Order[];
  orderLines: OrderLine[];
  allocations: Allocation[];
  approvals: Approval[];
  reservations: Reservation[];
  dayLogs: DayLog[];
  pastSales: PastSale[];
  inventory: InventoryItem[];
  purchaseOrders: PurchaseOrder[];
  purchaseRequests: PurchaseRequest[];
  revisions: Revision[];
  auditLog: AuditEntry[];
  seq: Record<string, number>;
};

function emptyStore(): Store {
  return {
    users: [],
    customers: [],
    lines: [],
    lineProducts: [],
    capacityOverrides: [],
    skus: [],
    settings: [],
    orders: [],
    orderLines: [],
    allocations: [],
    approvals: [],
    reservations: [],
    dayLogs: [],
    pastSales: [],
    inventory: [],
    purchaseOrders: [],
    purchaseRequests: [],
    revisions: [],
    auditLog: [],
    seq: {},
  };
}

// Demo data lives in server memory (kept on globalThis so dev reloads don't wipe it) and resets on restart.
const g = globalThis as unknown as { __slnStore?: Store; __slnVersion?: number };
const STORE_VERSION = 19;

export function store(): Store {
  if (!g.__slnStore || g.__slnVersion !== STORE_VERSION) {
    g.__slnStore = emptyStore();
    g.__slnVersion = STORE_VERSION;
    seedStore();
  }
  return g.__slnStore;
}

export function resetStore() {
  g.__slnStore = undefined;
  store();
}

export function nextId(table: string): number {
  const s = store();
  s.seq[table] = (s.seq[table] ?? 0) + 1;
  return s.seq[table];
}

// All-or-nothing update: restores the previous state if the callback throws.
export function transaction<T>(fn: () => T): T {
  const before = structuredClone(store());
  try {
    return fn();
  } catch (e) {
    g.__slnStore = before;
    throw e;
  }
}
