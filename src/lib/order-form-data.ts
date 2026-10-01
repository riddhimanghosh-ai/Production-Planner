import type { WizardState } from "@/components/order-wizard";
import { store } from "@/data/store";
import type { Order } from "@/data/types";
import { loadLines, planHorizon } from "./capacity";
import { addMonths, containerTonnes, ORIGINS, planningStart } from "./domain";
import { activeSkus, bdUsers, customers } from "./queries";
import { loadSettings } from "./settings";
import type { Viewer } from "./workflow";

export function orderFormProps(viewer: Viewer) {
  const st = store();
  const s = loadSettings();
  return {
    skus: activeSkus(),
    lines: loadLines({ activeOnly: true }).map((l) => ({ id: l.id, code: l.code, name: l.name, productTypes: l.productTypes })),
    customers: customers().map((c) => ({ ...c, orderCount: st.orders.filter((o) => o.customerId === c.id && o.status !== "DRAFT").length })),
    owners: bdUsers().map((u) => ({ id: u.id, name: u.name })),
    months: planHorizon(18),
    viewer: { id: viewer.id, role: viewer.role },
    marketPrices: Object.fromEntries(Object.keys(ORIGINS).map((o) => [o, s[`bean_price.${o}`]])),
    leadDays: Object.fromEntries(Object.keys(ORIGINS).map((o) => [o, s[`lead.transit.${o}`] + s["lead.bean_buffer"]])),
    settings: s,
  };
}

export function blankWizard(viewer: Viewer, prefill: { product?: string; from?: string; blend?: string; pack?: string } = {}): WizardState {
  const from = prefill.from && /^\d{4}-\d{2}$/.test(prefill.from) && prefill.from >= planningStart() ? prefill.from : addMonths(planningStart(), 3);
  return {
    productType: prefill.product && ["SD", "AG", "FDC"].includes(prefill.product) ? prefill.product : "",
    blend: prefill.blend && ["PURE", "CHICORY"].includes(prefill.blend) ? prefill.blend : "PURE",
    packFormat: prefill.pack && ["BULK", "GLASS", "CAN"].includes(prefill.pack) ? prefill.pack : "BULK",
    chicoryPct: 30,
    shipments: [{ month: from, size: "40", containers: prefill.product ? 1 : 0 }],
    pricePerKg: 0,
    manual: null,
    customerId: null,
    newCustomerName: "",
    customerCountry: "",
    contactPerson: "",
    customerType: "NEW",
    bdOwnerId: viewer.role === "BD_EXEC" && viewer.id ? viewer.id : 0,
    destinationCountry: "",
    destinationPort: "",
    incoterm: "CIF",
    freightBasis: "SELLER",
    gbGrade: "",
    beanOrigin: "",
    gbPriceClosed: false,
    gbClosedPrice: null,
    advancePct: 0,
    creditDays: 30,
    paymentMode: "Open account",
    currency: "INR",
    specNotes: "",
    spillOverride: "",
  };
}

// The guide edits one product across a run of months; an existing order's lines become its per-month split.
export function wizardFromOrder(order: Order): WizardState {
  const st = store();
  const lines = st.orderLines.filter((l) => l.orderId === order.id).sort((a, b) => a.month.localeCompare(b.month));
  const sku = st.skus.find((s) => s.id === lines[0]?.skuId);
  const months = [...new Set(lines.map((l) => l.month))];
  const manual: Record<string, Record<number, number>> = {};
  for (const l of lines) manual[l.month] = { ...(manual[l.month] ?? {}), [l.lineId]: (manual[l.month]?.[l.lineId] ?? 0) + l.quantityMt };
  return {
    productType: sku?.productType ?? "",
    blend: sku?.blend ?? "PURE",
    packFormat: sku?.packFormat ?? "BULK",
    chicoryPct: lines[0]?.chicoryPct || 30,
    shipments: order.shipments?.length
      ? order.shipments
      : months.map((m) => ({ month: m, size: "40" as const, containers: Math.max(1, Math.round(lines.filter((l) => l.month === m).reduce((a, l) => a + l.quantityMt, 0) / containerTonnes(loadSettings(), sku?.packFormat ?? "BULK", "40"))) })),
    pricePerKg: lines[0]?.pricePerKg ?? 0,
    manual,
    customerId: order.customerId,
    newCustomerName: "",
    customerCountry: "",
    contactPerson: order.contactPerson,
    customerType: order.customerType,
    bdOwnerId: order.bdOwnerId,
    destinationCountry: order.destinationCountry,
    destinationPort: order.destinationPort,
    incoterm: order.incoterm,
    freightBasis: order.freightBasis,
    gbGrade: order.gbGrade,
    beanOrigin: order.beanOrigin,
    gbPriceClosed: order.gbPriceClosed,
    gbClosedPrice: order.gbClosedPrice,
    advancePct: order.advancePct,
    creditDays: order.creditDays,
    paymentMode: order.paymentMode,
    currency: order.currency,
    specNotes: order.specNotes,
    spillOverride: order.spillOverride,
  };
}
