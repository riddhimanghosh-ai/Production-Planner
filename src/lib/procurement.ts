import type { Sku } from "@/data/types";
import { addDays, addMonths, beanPrice, isoDate, monthStartDate, ORIGINS, type Origin } from "./domain";
import type { Settings } from "./settings";

export const MATERIAL_GROUPS = ["Green beans", "Chicory", "Packing material", "Cans"] as const;
export type MaterialGroup = (typeof MATERIAL_GROUPS)[number];

export type ProcurementDraft = {
  key: string;
  group: MaterialGroup;
  material: string;
  quantity: number;
  unit: string;
  productionMonth: string;
  requiredBy: string;
  orderBy: string;
  estCostInr: number;
};

export function describeMaterial(key: string): { group: MaterialGroup; name: string; unit: string } {
  const [kind, a, b] = key.split("|");
  if (kind === "GB") return { group: "Green beans", name: `Green beans · ${ORIGINS[a as Origin] ?? a} · ${b}`, unit: "kg" };
  if (kind === "CHICORY") return { group: "Chicory", name: "Chicory", unit: "kg" };
  if (kind === "CAN") return { group: "Cans", name: `Printed cans (${a} g)`, unit: "cans" };
  if (a === "CARTON") return { group: "Packing material", name: `Bulk bags (${b} kg)`, unit: "bags" };
  if (a === "JAR") return { group: "Packing material", name: `Glass jars + lids (${b} g)`, unit: "jars" };
  return { group: "Packing material", name: "Customer labels", unit: "labels" };
}

export function materialLeads(sku: Pick<Sku, "packFormat"> & { coffeeShare: number }, beanOrigin: string, s: Settings): { material: string; days: number }[] {
  const leads = [
    { material: `Green beans (${ORIGINS[beanOrigin as Origin] ?? beanOrigin})`, days: s[`lead.transit.${beanOrigin}`] + s["lead.bean_buffer"] },
    { material: sku.packFormat === "CAN" ? "Printed cans" : sku.packFormat === "GLASS" ? "Glass jars & labels" : "Export cartons", days: s[sku.packFormat === "CAN" ? "lead.cans" : "lead.packaging"] },
  ];
  if (sku.coffeeShare < 1) leads.push({ material: "Chicory", days: s["lead.chicory"] });
  return leads;
}

// Earliest production month whose materials can be on site if ordered on `asOfIso`.
export function earliestMaterialMonth(sku: Pick<Sku, "packFormat"> & { coffeeShare: number }, beanOrigin: string, s: Settings, asOfIso: string) {
  const binding = materialLeads(sku, beanOrigin, s).sort((a, b) => b.days - a.days)[0];
  const arrival = addDays(new Date(`${asOfIso}T00:00:00Z`), binding.days);
  const neededStart = addDays(arrival, s["lead.material_before_production"]);
  const month = isoDate(neededStart).slice(0, 7);
  return {
    month: neededStart.getUTCDate() === 1 ? month : addMonths(month, 1),
    arrival: isoDate(arrival),
    binding: binding.material,
  };
}

export function requirementsFor(
  sku: Pick<Sku, "productType" | "packFormat" | "packSizeKg"> & { coffeeShare: number },
  order: { beanOrigin: string; gbGrade: string; gbClosedPrice?: number | null },
  alloc: { month: string; quantityMt: number },
  s: Settings,
): ProcurementDraft[] {
  const kg = alloc.quantityMt * 1000;
  const requiredBy = addDays(monthStartDate(alloc.month), -s["lead.material_before_production"]);
  const due = (leadDays: number) => isoDate(addDays(requiredBy, -leadDays));
  const base = { productionMonth: alloc.month, requiredBy: isoDate(requiredBy) };
  const origin = ORIGINS[order.beanOrigin as Origin] ?? order.beanOrigin;
  const items: ProcurementDraft[] = [];

  const beanKg = kg * sku.coffeeShare * s[`yield.${sku.productType}`];
  items.push({
    ...base,
    key: `GB|${order.beanOrigin}|${order.gbGrade}`,
    group: "Green beans",
    material: `Green beans · ${origin} · ${order.gbGrade}`,
    quantity: beanKg,
    unit: "kg",
    orderBy: due(s[`lead.transit.${order.beanOrigin}`] + s["lead.bean_buffer"]),
    estCostInr: beanKg * (order.gbClosedPrice || beanPrice(s, order.beanOrigin, order.gbGrade)),
  });

  if (sku.coffeeShare < 1) {
    const chicoryKg = kg * (1 - sku.coffeeShare) * s["chicory.yield"];
    items.push({
      ...base,
      key: "CHICORY",
      group: "Chicory",
      material: "Chicory",
      quantity: chicoryKg,
      unit: "kg",
      orderBy: due(s["lead.chicory"]),
      estCostInr: chicoryKg * s["chicory.price"],
    });
  }

  const units = Math.ceil(kg / sku.packSizeKg);
  const grams = Math.round(sku.packSizeKg * 1000);
  const packCost = kg * s[`packaging.${sku.packFormat}`];
  if (sku.packFormat === "BULK") {
    items.push({ ...base, key: `PM|CARTON|${sku.packSizeKg}`, group: "Packing material", material: `Bulk bags (${sku.packSizeKg} kg)`, quantity: units, unit: "bags", orderBy: due(s["lead.packaging"]), estCostInr: packCost });
  } else if (sku.packFormat === "GLASS") {
    items.push({ ...base, key: `PM|JAR|${grams}`, group: "Packing material", material: `Glass jars + lids (${grams} g)`, quantity: units, unit: "jars", orderBy: due(s["lead.packaging"]), estCostInr: packCost * 0.85 });
    items.push({ ...base, key: "PM|LABEL", group: "Packing material", material: "Customer labels", quantity: units, unit: "labels", orderBy: due(s["lead.packaging"]), estCostInr: packCost * 0.15 });
  } else {
    items.push({ ...base, key: `CAN|${grams}`, group: "Cans", material: `Printed cans (${grams} g)`, quantity: units, unit: "cans", orderBy: due(s["lead.cans"]), estCostInr: packCost });
  }
  return items;
}
