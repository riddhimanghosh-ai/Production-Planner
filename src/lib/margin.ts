import type { Sku } from "@/data/types";
import { beanPrice as marketBeanPrice, PACK_FORMATS, PRODUCT_TYPES, type PackFormat, type ProductType } from "./domain";
import type { Settings } from "./settings";

export type MarginInput = {
  sku: Pick<Sku, "productType" | "blend" | "packFormat"> & { coffeeShare: number };
  quantityMt: number;
  pricePerKg: number;
  currency: string;
  beanOrigin: string;
  gbGrade?: string | null;
  gbClosedPrice?: number | null;
  freightBasis: string;
  advancePct: number;
  creditDays: number;
};

export type MarginResult = {
  lines: { label: string; perKg: number; how?: string }[];
  priceInrPerKg: number;
  costPerKg: number;
  marginPerKg: number;
  marginPct: number;
  revenue: number;
  totalCost: number;
  totalMargin: number;
  greenBeanKg: number;
  beanPricePerKg: number;
  beanPriceClosed: boolean;
  targetPct: number;
};

export function computeMargin(input: MarginInput, s: Settings): MarginResult {
  const { sku, quantityMt, beanOrigin } = input;
  const kg = quantityMt * 1000;
  const priceInr = input.currency === "USD" ? input.pricePerKg * s["fx.usd_inr"] : input.pricePerKg;
  const closed = input.gbClosedPrice != null && input.gbClosedPrice > 0;
  const beanPrice = closed ? input.gbClosedPrice! : marketBeanPrice(s, beanOrigin, input.gbGrade);
  const beanYield = s[`yield.${sku.productType}`];

  const greenBean = sku.coffeeShare * beanYield * beanPrice;
  const chicory = (1 - sku.coffeeShare) * s["chicory.yield"] * s["chicory.price"];
  const conversion = s[`conversion.${sku.productType}`];
  const packaging = s[`packaging.${sku.packFormat}`];
  const freight = input.freightBasis === "BUYER" ? s["logistics.docs_per_kg"] : s["logistics.per_kg"];
  const financed = 1 - Math.min(Math.max(input.advancePct, 0), 100) / 100;
  const finance = priceInr * (s["finance.cost_pct_30d"] / 100) * (input.creditDays / 30) * financed;

  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const num = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const lines = [
    {
      label: `Green beans${closed ? " (price fixed)" : ""}`,
      perKg: greenBean,
      how: `${sku.coffeeShare < 1 ? `${pct(sku.coffeeShare)} coffee × ` : ""}${num(beanYield)} kg beans × ₹${num(beanPrice)}/kg`,
    },
    ...(chicory > 0 ? [{ label: "Chicory", perKg: chicory, how: `${pct(1 - sku.coffeeShare)} chicory × ${num(s["chicory.yield"])} kg root × ₹${num(s["chicory.price"])}/kg` }] : []),
    { label: "Making (roast, brew, dry)", perKg: conversion, how: `${PRODUCT_TYPES[sku.productType as ProductType] ?? sku.productType} rate` },
    { label: "Packing", perKg: packaging, how: `${PACK_FORMATS[sku.packFormat as PackFormat] ?? sku.packFormat} rate` },
    { label: input.freightBasis === "BUYER" ? "Paperwork & handling" : "Freight & shipping", perKg: freight, how: input.freightBasis === "BUYER" ? "Customer collects and pays freight" : "We deliver, freight is in our price" },
    ...(finance > 0
      ? [
          {
            label: `Waiting for payment (${input.creditDays} days)`,
            perKg: finance,
            how: `₹${num(priceInr)} × ${num(s["finance.cost_pct_30d"])}% per month × ${num(input.creditDays / 30)} month${input.creditDays === 30 ? "" : "s"}${financed < 1 ? ` × ${pct(financed)} not paid in advance` : ""}`,
          },
        ]
      : []),
  ];
  const costPerKg = lines.reduce((a, l) => a + l.perKg, 0);
  const marginPerKg = priceInr - costPerKg;

  return {
    lines,
    priceInrPerKg: priceInr,
    costPerKg,
    marginPerKg,
    marginPct: priceInr > 0 ? (marginPerKg / priceInr) * 100 : 0,
    revenue: priceInr * kg,
    totalCost: costPerKg * kg,
    totalMargin: marginPerKg * kg,
    greenBeanKg: kg * sku.coffeeShare * beanYield,
    beanPricePerKg: beanPrice,
    beanPriceClosed: closed,
    targetPct: s["margin.target_pct"],
  };
}

export type OrderMargin = {
  revenue: number;
  totalCost: number;
  totalMargin: number;
  marginPct: number;
  targetPct: number;
  greenBeanKg: number;
  byLine: Record<number, MarginResult>;
};

export function rollUp(byLine: Record<number, MarginResult>, targetPct: number): OrderMargin {
  const rs = Object.values(byLine);
  const revenue = rs.reduce((a, r) => a + r.revenue, 0);
  const totalMargin = rs.reduce((a, r) => a + r.totalMargin, 0);
  return {
    revenue,
    totalCost: rs.reduce((a, r) => a + r.totalCost, 0),
    totalMargin,
    marginPct: revenue > 0 ? (totalMargin / revenue) * 100 : 0,
    targetPct,
    greenBeanKg: rs.reduce((a, r) => a + r.greenBeanKg, 0),
    byLine,
  };
}
