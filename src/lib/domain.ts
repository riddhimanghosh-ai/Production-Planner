export const ROLES = ["ALL", "BD_EXEC", "BD_HEAD", "CFO", "COO", "PLANNER", "PROCUREMENT", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ALL: "All access (demo)",
  BD_EXEC: "Salesperson",
  BD_HEAD: "Sales head",
  CFO: "CFO",
  COO: "COO",
  PLANNER: "Production planner",
  PROCUREMENT: "Procurement",
  ADMIN: "Admin",
};

// Only the CFO and COO commit capacity; both must approve every order.
export const APPROVER_ROLES = ["CFO", "COO"] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

export const APPROVER_FOCUS: Record<ApproverRole, string> = {
  CFO: "Price, profit and payment terms",
  COO: "Factory space, raw coffee and delivery timing",
};

// All access can take every action, for walking stakeholders through the prototype.
export function can(role: Role, allowed: Role[]): boolean {
  return role === "ALL" || allowed.includes(role);
}

// Plain-language product vocabulary: the drying method uses a production line; recipe and pack only change materials.
export const PRODUCT_TYPES = { SD: "Spray-dried", AG: "Agglomerated", FDC: "Freeze-dried" } as const;
export type ProductType = keyof typeof PRODUCT_TYPES;
export const PRODUCT_HINTS: Record<ProductType, string> = {
  SD: "Fine powder, the everyday instant coffee",
  AG: "Spray-dried powder made into granules",
  FDC: "Freeze-dried crystals, premium",
};

export const BLENDS = { PURE: "Pure coffee", CHICORY: "Coffee + chicory" } as const;
export const BLEND_HINTS = { PURE: "100% coffee", CHICORY: "Mixed with chicory root, cheaper, popular in India" } as const;

export function coffeeShare(blend: string, chicoryPct: number): number {
  return blend === "CHICORY" ? 1 - chicoryPct / 100 : 1;
}
// Tonnes per ship month for an order's shipments.
export function shipmentTonnes(shipments: { month: string; quantityMt: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sh of shipments) out[sh.month] = Math.round(((out[sh.month] ?? 0) + sh.quantityMt) * 10) / 10;
  return out;
}

export const PACK_FORMATS = { BULK: "Bulk bags", GLASS: "Glass jars", CAN: "Cans" } as const;
export type PackFormat = keyof typeof PACK_FORMATS;
export const PACK_HINTS = { BULK: "25 kg bags for other brands to repack", GLASS: "100 g jars with the customer's label", CAN: "200 g cans with the customer's label" } as const;

export function productLabel(sku: { productType: string; blend: string; packFormat: string }, chicoryPct = 0) {
  const blend = sku.blend === "CHICORY" ? `Coffee + chicory${chicoryPct ? ` (${chicoryPct}%)` : ""}` : "Pure coffee";
  return `${PRODUCT_TYPES[sku.productType as ProductType] ?? sku.productType} · ${blend} · ${PACK_FORMATS[sku.packFormat as PackFormat] ?? sku.packFormat}`;
}

export const ORIGINS = { VIETNAM: "Vietnam", BRAZIL: "Brazil", INDIA: "India" } as const;
export type Origin = keyof typeof ORIGINS;

export const PAYMENT_MODES = ["Advance", "LC at sight", "LC usance", "CAD", "Open account"];
export const CURRENCIES = ["INR", "USD"] as const;
export const FREIGHT_BASIS = { SELLER: "We deliver (freight in our price)", BUYER: "Customer collects (they pay freight)" } as const;
// Green bean grades each origin supplies. Price is set per origin and grade in settings.
export const BEAN_GRADES: Record<Origin, string[]> = {
  INDIA: ["Robusta Cherry AA", "Robusta Parchment AB", "Arabica Plantation A", "Arabica Cherry AB"],
  VIETNAM: ["Robusta Screen 16", "Robusta Screen 18"],
  BRAZIL: ["Arabica Santos 17/18", "Conilon Robusta 13"],
};
export const GB_GRADES = [...new Set(Object.values(BEAN_GRADES).flat())];
export const gradeKey = (grade: string) =>
  grade
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
export const beanPriceKey = (origin: string, grade: string) => `bean_price.${origin}.${gradeKey(grade)}`;
// A grade's market price; falls back to the origin's first grade when the grade is unknown or not given.
export function beanPrice(s: Record<string, number>, origin: string, grade?: string | null): number {
  if (grade && s[beanPriceKey(origin, grade)] != null) return s[beanPriceKey(origin, grade)];
  const first = BEAN_GRADES[origin as Origin]?.[0];
  return (first ? s[beanPriceKey(origin, first)] : undefined) ?? s[`bean_price.${origin}`] ?? 0;
}
export const validGrade = (origin: string, grade: string) => (BEAN_GRADES[origin as Origin]?.includes(grade) ? grade : (BEAN_GRADES[origin as Origin]?.[0] ?? grade));
export const INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "DAP"];

export const ORDER_STATUS = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Waiting for approval",
  SENT_BACK: "Sent back",
  COMMITTED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
} as const;
export type OrderStatus = keyof typeof ORDER_STATUS;

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// The current month's production is already locked, so new plans start next month.
export function planningStart(): string {
  return addMonths(currentMonth(), 1);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function monthLabel(month: string, withYear = true): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-IN", {
    month: "short",
    year: withYear ? "2-digit" : undefined,
    timeZone: "UTC",
  });
}

export function monthStartDate(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const CRORE = 10_000_000;
const LAKH = 100_000;

export function formatInr(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= CRORE) return `${sign}₹${(abs / CRORE).toFixed(2)} Cr`;
  if (abs >= LAKH) return `${sign}₹${(abs / LAKH).toFixed(1)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

export function formatPerKg(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}/kg`;
}

export function formatMt(value: number): string {
  return `${value.toLocaleString("en-IN", { maximumFractionDigits: 1 })} MT`;
}

export function formatQty(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
