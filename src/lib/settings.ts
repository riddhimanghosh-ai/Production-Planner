import { store } from "@/data/store";
import { BEAN_GRADES, beanPriceKey, ORIGINS, type Origin } from "./domain";

export type SettingDef = { key: string; value: number; label: string; unit: string; grp: string };

export const SETTING_GROUPS = ["Raw coffee & chicory", "Making & packing", "Freight, currency & credit", "Approval rules", "Planning", "Lead times", "Changeovers"] as const;
// Cost rates live on the Profit & costs screen; planning rules live in Settings.
export const COST_GROUPS = ["Raw coffee & chicory", "Making & packing", "Freight, currency & credit", "Approval rules"];
export const PLANNING_GROUPS = ["Planning", "Lead times"];

// Indicative figures for the prototype; leadership edits these in Settings.
export const DEFAULT_SETTINGS: SettingDef[] = [
  // Green bean market price per origin and grade (Robusta cheaper than Arabica; indicative).
  ...Object.entries({
    INDIA: { "Robusta Cherry AA": 365, "Robusta Parchment AB": 395, "Arabica Plantation A": 540, "Arabica Cherry AB": 480 },
    VIETNAM: { "Robusta Screen 16": 380, "Robusta Screen 18": 400 },
    BRAZIL: { "Arabica Santos 17/18": 520, "Conilon Robusta 13": 410 },
  } as Record<Origin, Record<string, number>>).flatMap(([origin, grades]) =>
    BEAN_GRADES[origin as Origin].map((g) => ({ key: beanPriceKey(origin, g), value: grades[g] ?? 400, label: `Green bean market price, ${ORIGINS[origin as Origin]} · ${g}`, unit: "₹/kg", grp: "Raw coffee & chicory" })),
  ),
  { key: "yield.SD", value: 2.4, label: "Green beans needed for 1 kg of Spray-dried", unit: "kg/kg", grp: "Raw coffee & chicory" },
  { key: "yield.AG", value: 2.45, label: "Green beans needed for 1 kg of Agglomerated", unit: "kg/kg", grp: "Raw coffee & chicory" },
  { key: "yield.FDC", value: 2.6, label: "Green beans needed for 1 kg of Freeze-dried", unit: "kg/kg", grp: "Raw coffee & chicory" },
  { key: "chicory.price", value: 55, label: "Chicory root price", unit: "₹/kg", grp: "Raw coffee & chicory" },
  { key: "chicory.yield", value: 2.8, label: "Chicory root needed for 1 kg of chicory in the blend", unit: "kg/kg", grp: "Raw coffee & chicory" },

  { key: "conversion.SD", value: 140, label: "Making cost, Spray-dried", unit: "₹/kg", grp: "Making & packing" },
  { key: "conversion.AG", value: 175, label: "Making cost, Agglomerated", unit: "₹/kg", grp: "Making & packing" },
  { key: "conversion.FDC", value: 420, label: "Making cost, Freeze-dried", unit: "₹/kg", grp: "Making & packing" },
  { key: "packaging.BULK", value: 25, label: "Packing, Bulk bags", unit: "₹/kg", grp: "Making & packing" },
  { key: "packaging.GLASS", value: 210, label: "Packing, Glass jars with customer label", unit: "₹/kg", grp: "Making & packing" },
  { key: "packaging.CAN", value: 150, label: "Packing, Cans with customer label", unit: "₹/kg", grp: "Making & packing" },

  { key: "logistics.per_kg", value: 45, label: "Freight & shipping when we deliver", unit: "₹/kg", grp: "Freight, currency & credit" },
  { key: "logistics.docs_per_kg", value: 8, label: "Paperwork & handling when the customer collects", unit: "₹/kg", grp: "Freight, currency & credit" },
  { key: "fx.usd_inr", value: 88, label: "Dollar rate for USD-priced orders", unit: "₹/USD", grp: "Freight, currency & credit" },
  { key: "finance.cost_pct_30d", value: 0.8, label: "Cost of waiting for payment, per 30 days", unit: "% of price", grp: "Freight, currency & credit" },

  { key: "margin.target_pct", value: 18, label: "CFO minimum margin (below this is flagged red)", unit: "%", grp: "Approval rules" },
  { key: "approval.cfo_credit_days", value: 60, label: "Flag credit terms longer than", unit: "days", grp: "Approval rules" },

  { key: "pack_capacity.GLASS", value: 30, label: "Glass filling capacity", unit: "MT/month", grp: "Planning" },
  { key: "pack_capacity.CAN", value: 30, label: "Can filling capacity", unit: "MT/month", grp: "Planning" },

  { key: "lead.transit.VIETNAM", value: 35, label: "Green bean transit, Vietnam", unit: "days", grp: "Lead times" },
  { key: "lead.transit.BRAZIL", value: 60, label: "Green bean transit, Brazil", unit: "days", grp: "Lead times" },
  { key: "lead.transit.INDIA", value: 10, label: "Green bean transit, India", unit: "days", grp: "Lead times" },
  { key: "lead.bean_buffer", value: 15, label: "Bean contracting & clearance buffer", unit: "days", grp: "Lead times" },
  { key: "lead.chicory", value: 20, label: "Chicory procurement lead", unit: "days", grp: "Lead times" },
  { key: "lead.packaging", value: 30, label: "Glass, cartons & labels lead", unit: "days", grp: "Lead times" },
  { key: "lead.cans", value: 45, label: "Printed cans lead", unit: "days", grp: "Lead times" },
  { key: "lead.material_before_production", value: 7, label: "Materials needed on site before production", unit: "days", grp: "Lead times" },
];

// Hours a line loses when it switches what it makes (stop, clean, restart). Placeholders until SLN confirms.
export const CHANGEOVER_DEFAULTS: SettingDef[] = [
  { key: "changeover.SD_AG", value: 4, label: "Spray-dried → Agglomerated", unit: "hours", grp: "Changeovers" },
  { key: "changeover.AG_SD", value: 6, label: "Agglomerated → Spray-dried", unit: "hours", grp: "Changeovers" },
  { key: "changeover.PURE_CHICORY", value: 2, label: "Pure coffee → Coffee + chicory", unit: "hours", grp: "Changeovers" },
  { key: "changeover.CHICORY_PURE", value: 8, label: "Coffee + chicory → Pure coffee (full clean)", unit: "hours", grp: "Changeovers" },
];
DEFAULT_SETTINGS.push(...CHANGEOVER_DEFAULTS);

export type Settings = Record<string, number>;

export function loadSettings(): Settings {
  const out: Settings = Object.fromEntries(DEFAULT_SETTINGS.map((d) => [d.key, d.value]));
  for (const r of store().settings) out[r.key] = r.value;
  return out;
}
