import type { Role } from "@/lib/domain";

export type User = { id: number; name: string; role: Role; email: string };

export type Customer = { id: number; name: string; country: string; contactPerson: string; bdOwnerId: number };

// A line has one monthly capacity shared by every product it can make.
// runDays: weekdays the line works (0 = Sunday … 6 = Saturday). Defaults to Monday–Saturday.
export type Line = { id: number; code: string; name: string; active: boolean; capacityMt: number; capacityConfirmed: boolean; runDays?: number[] };
// capacityMt: this product's share of the line's normal monthly tonnes. The line's capacity is the sum of its products.
export type LineProduct = { lineId: number; productType: string; capacityMt?: number };
export type CapacityOverride = { lineId: number; month: string; capacityMt: number; note: string };

// Planner-held line time with no order behind it yet (e.g. expected repeat business).
export type Reservation = { id: number; lineId: number; month: string; quantityMt: number; label: string; productType: string; createdBy: string };

export type InventoryItem = { key: string; group: string; name: string; unit: string; onHand: number };
export type PurchaseOrder = { id: number; materialKey: string; quantity: number; arrivalMonth: string; supplier: string; status: "ORDERED" | "RECEIVED"; createdBy: string; createdAt: Date; requestId: number | null };
export type PurchaseRequest = { id: number; materialKey: string; quantity: number; neededBy: string; note: string; status: "OPEN" | "ORDERED" | "DISMISSED"; raisedBy: string; createdAt: Date; poId: number | null };

export type Sku = {
  id: number;
  code: string;
  name: string;
  productType: string;
  blend: string;
  packFormat: string;
  packSizeKg: number;
  active: boolean;
};

export type Setting = { key: string; value: number; label: string; unit: string; grp: string; sort: number };

// Export business: an order is supplied in containers. One shipment = N containers of one size in a ship month.
export type ContainerSize = "20" | "40";
export type Shipment = { month: string; size: ContainerSize; containers: number };

export type Order = {
  id: number;
  ref: string;
  status: string;
  version: number;
  priority: "NORMAL" | "HIGH";
  // 1. Customer details
  customerId: number;
  contactPerson: string;
  customerType: "NEW" | "REPEAT";
  bdOwnerId: number;
  // 2. Land profile
  destinationCountry: string;
  destinationPort: string;
  incoterm: string;
  freightBasis: string;
  // 3. Raw material needs (+ green bean panel)
  gbGrade: string;
  beanOrigin: string;
  gbPriceClosed: boolean;
  gbClosedPrice: number | null;
  // 4. Payment terms
  advancePct: number;
  creditDays: number;
  paymentMode: string;
  currency: string;
  // 5. Basic process flow (product, line, blend and pack live on each order line)
  specNotes: string;
  spillOverride: string;
  shipments?: Shipment[];
  marginSnapshot: unknown;
  issues: unknown;
  createdAt: Date;
  submittedAt: Date | null;
  decidedAt: Date | null;
};

// One line = product × delivery month × quantity × price, made on a chosen production line.
export type OrderLine = {
  id: number;
  orderId: number;
  skuId: number;
  chicoryPct: number;
  month: string;
  quantityMt: number;
  pricePerKg: number;
  lineId: number;
};

export type Allocation = {
  id: number;
  orderId: number;
  orderLineId: number;
  lineId: number;
  month: string;
  quantityMt: number;
  // What the factory actually made for this slot, recorded by the planner.
  producedMt?: number;
  producedAt?: Date | null;
  productionNote?: string;
};

// One line on one day: the planner locks it at the start of the shift, can change capacity mid-day, and records what was made.
export type DayEvent = { at: Date; by: string; capacityT: number; reason: string };
export type DayLog = {
  id: number;
  lineId: number;
  date: string; // YYYY-MM-DD
  allocationId: number | null; // the order slot being run
  capacityT: number; // current running capacity for the day
  lockedAt: Date;
  lockedBy: string;
  events: DayEvent[];
  madeT: number | null;
  closedAt: Date | null;
  stopped?: boolean; // line marked "not running" for the whole day
};

export type Approval = {
  id: number;
  orderId: number;
  role: string;
  focus: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "SENT_BACK";
  comment: string;
  decidedAt: Date | null;
  decidedBy: string | null;
};

export type Revision = { id: number; orderId: number; version: number; at: Date; by: string; changes: string[]; reapproval: boolean };

export type AuditEntry = { id: number; at: Date; by: string; role: string; action: string; orderId: number | null; detail: string };
