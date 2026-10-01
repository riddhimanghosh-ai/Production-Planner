"use client";

import { useMemo, useState } from "react";
import { BLENDS, coffeeShare, CURRENCIES, formatInr, ORIGINS, PACK_FORMATS, PRODUCT_TYPES } from "@/lib/domain";
import { computeMargin, type MarginInput } from "@/lib/margin";
import type { Settings } from "@/lib/settings";
import { cx, tbl } from "./ui";

const rs = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export function MarginCalculator({ settings, products }: { settings: Settings; products: string[] }) {
  const [v, setV] = useState({
    productType: products[0] ?? "SD",
    blend: "PURE",
    chicoryPct: 30,
    packFormat: "BULK",
    quantityMt: 50,
    beanOrigin: "VIETNAM",
    beanPrice: settings["bean_price.VIETNAM"],
    currency: "INR",
    pricePerKg: 1450,
    freightBasis: "SELLER",
    advancePct: 0,
    creditDays: 30,
  });
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((x) => ({ ...x, [k]: value }));
  const market = settings[`bean_price.${v.beanOrigin}`];
  const fx = settings["fx.usd_inr"];
  const target = settings["margin.target_pct"];
  const [wanted, setWanted] = useState(target);

  const calc = useMemo(() => {
    const base: MarginInput = {
      sku: { productType: v.productType, blend: v.blend, packFormat: v.packFormat, coffeeShare: coffeeShare(v.blend, v.chicoryPct) },
      quantityMt: Number(v.quantityMt) || 0,
      pricePerKg: Number(v.pricePerKg) || 0,
      currency: v.currency,
      beanOrigin: v.beanOrigin,
      gbClosedPrice: Number(v.beanPrice) !== market ? Number(v.beanPrice) : null,
      freightBasis: v.freightBasis,
      advancePct: Number(v.advancePct) || 0,
      creditDays: Number(v.creditDays) || 0,
    };
    const r = computeMargin(base, settings);
    // Credit cost grows with price, everything else is fixed per kg: price = fixed ÷ (1 − credit share − margin).
    const creditShare = (settings["finance.cost_pct_30d"] / 100) * (base.creditDays / 30) * (1 - Math.min(Math.max(base.advancePct, 0), 100) / 100);
    const fixed = r.costPerKg - r.priceInrPerKg * creditShare;
    const priceFor = (marginPct: number) => {
      const d = 1 - creditShare - marginPct / 100;
      return d > 0 ? fixed / d : null;
    };
    return { r, priceFor };
  }, [v, settings, market]);

  const { r } = calc;
  const toQuote = (inr: number | null) => (inr == null ? "–" : v.currency === "USD" ? `$${(inr / fx).toFixed(2)}/kg` : `${rs(inr)}/kg`);
  const ok = r.marginPct >= target;
  const kg = (Number(v.quantityMt) || 0) * 1000;
  const pct = (n: number) => (r.priceInrPerKg > 0 ? `${((n / r.priceInrPerKg) * 100).toFixed(1)}%` : "–");
  // Every cost head, always listed (₹0 when it doesn't apply) so the sheet is complete.
  const find = (prefix: string) => r.lines.find((l) => l.label.startsWith(prefix));
  const breakdown = [
    { label: "Green beans", l: find("Green beans"), none: "" },
    { label: "Chicory", l: find("Chicory"), none: "Pure coffee, no chicory" },
    { label: "Making", l: find("Making"), none: "" },
    { label: "Packing", l: find("Packing"), none: "" },
    { label: v.freightBasis === "BUYER" ? "Paperwork & handling" : "Freight & shipping", l: find(v.freightBasis === "BUYER" ? "Paperwork" : "Freight"), none: "" },
    { label: "Waiting for payment", l: find("Waiting"), none: Number(v.creditDays) > 0 ? "Paid in advance" : "Paid on delivery" },
  ].map((x) => ({ label: x.label, perKg: x.l?.perKg ?? 0, how: x.l?.how ?? x.none }));

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-stone-300 bg-white p-3">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <F label="Product">
            <Select value={v.productType} onChange={(x) => set("productType", x)} options={products.map((p) => [p, PRODUCT_TYPES[p as keyof typeof PRODUCT_TYPES]])} />
          </F>
          <F label="Blend">
            <Select value={v.blend} onChange={(x) => set("blend", x)} options={Object.entries(BLENDS)} />
          </F>
          {v.blend === "CHICORY" && (
            <F label="Chicory %">
              <Num value={v.chicoryPct} onChange={(x) => set("chicoryPct", x)} />
            </F>
          )}
          <F label="Pack">
            <Select value={v.packFormat} onChange={(x) => set("packFormat", x)} options={Object.entries(PACK_FORMATS)} />
          </F>
          <F label="Tonnes">
            <Num value={v.quantityMt} onChange={(x) => set("quantityMt", x)} />
          </F>
          <F label="Beans from">
            <Select value={v.beanOrigin} onChange={(x) => setV((s) => ({ ...s, beanOrigin: x, beanPrice: settings[`bean_price.${x}`] }))} options={Object.entries(ORIGINS)} />
          </F>
          <F label="Bean ₹/kg">
            <Num value={v.beanPrice} onChange={(x) => set("beanPrice", x)} />
          </F>
          <F label="Delivery">
            <Select
              value={v.freightBasis}
              onChange={(x) => set("freightBasis", x)}
              options={[
                ["SELLER", "We deliver"],
                ["BUYER", "Customer collects"],
              ]}
            />
          </F>
          <F label="Advance %">
            <Num value={v.advancePct} onChange={(x) => set("advancePct", x)} />
          </F>
          <F label="Days to pay">
            <Num value={v.creditDays} onChange={(x) => set("creditDays", x)} />
          </F>
          <F label="Currency">
            <Select value={v.currency} onChange={(x) => set("currency", x)} options={CURRENCIES.map((c) => [c, c])} />
          </F>
          <F label={`Price ${v.currency}/kg`}>
            <Num value={v.pricePerKg} onChange={(x) => set("pricePerKg", x)} step="any" strong />
          </F>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-stone-300 bg-white">
        <table className="tabular w-full text-[13px]">
          <thead>
            <tr>
              <th className={tbl.thR}>Cost / kg</th>
              <th className={tbl.thR}>Profit / kg</th>
              <th className={tbl.thR}>Margin</th>
              <th className={tbl.thR}>Total profit</th>
              <th className={tbl.thR}>
                <span className="inline-flex items-center gap-1">
                  Lowest price for
                  <input type="number" min="0" max="80" value={wanted} onChange={(e) => setWanted(Number(e.target.value))} className={cx(tbl.input, "w-12 py-0 text-right normal-case")} aria-label="Wanted margin %" />%
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="text-[15px] font-semibold">
              <td className={tbl.tdR}>{rs(r.costPerKg)}</td>
              <td className={cx(tbl.tdR, r.marginPerKg < 0 && "text-red-700")}>{rs(r.marginPerKg)}</td>
              <td className={cx(tbl.tdR, ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>{r.marginPct.toFixed(1)}%</td>
              <td className={tbl.tdR}>{formatInr(r.totalMargin)}</td>
              <td className={tbl.tdR}>{toQuote(calc.priceFor(wanted))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-md border border-stone-300 bg-white">
        <table className="tabular w-full min-w-[720px] text-[13px]">
          <thead>
            <tr>
              <th className={tbl.th}>Cost breakdown</th>
              <th className={tbl.th}>How it&apos;s worked out</th>
              <th className={tbl.thR}>₹ / kg</th>
              <th className={tbl.thR}>% of price</th>
              <th className={tbl.thR}>For {v.quantityMt} t</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((l) => (
              <tr key={l.label} className={cx(l.perKg === 0 && "text-stone-400")}>
                <td className={tbl.td}>{l.label}</td>
                <td className={cx(tbl.td, "text-[12px] text-stone-500")}>{l.how}</td>
                <td className={tbl.tdR}>{rs(l.perKg)}</td>
                <td className={tbl.tdR}>{pct(l.perKg)}</td>
                <td className={tbl.tdR}>{formatInr(l.perKg * kg)}</td>
              </tr>
            ))}
            <tr className="bg-stone-50 font-semibold">
              <td className={tbl.td}>Total cost</td>
              <td className={tbl.td} />
              <td className={tbl.tdR}>{rs(r.costPerKg)}</td>
              <td className={tbl.tdR}>{pct(r.costPerKg)}</td>
              <td className={tbl.tdR}>{formatInr(r.totalCost)}</td>
            </tr>
            <tr>
              <td className={tbl.td}>Selling price</td>
              <td className={cx(tbl.td, "text-[12px] text-stone-500")}>{v.currency === "USD" ? `$${v.pricePerKg} × ₹${fx}/$` : ""}</td>
              <td className={tbl.tdR}>{rs(r.priceInrPerKg)}</td>
              <td className={tbl.tdR}>100%</td>
              <td className={tbl.tdR}>{formatInr(r.revenue)}</td>
            </tr>
            <tr className={cx("font-semibold", ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800")}>
              <td className={tbl.td}>Profit</td>
              <td className={cx(tbl.td, "text-[12px] font-normal")}>selling price − total cost</td>
              <td className={tbl.tdR}>{rs(r.marginPerKg)}</td>
              <td className={tbl.tdR}>{r.marginPct.toFixed(1)}%</td>
              <td className={tbl.tdR}>{formatInr(r.totalMargin)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-600">{label}</span>
      {children}
    </label>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: (readonly [string, string])[] | [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cx(tbl.input, "w-full py-1")}>
      {options.map(([k, label]) => (
        <option key={k} value={k}>
          {label}
        </option>
      ))}
    </select>
  );
}

function Num({ value, onChange, step, strong }: { value: number; onChange: (v: number) => void; step?: string; strong?: boolean }) {
  return <input type="number" min="0" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className={cx(tbl.input, "w-full py-1 text-right", strong && "font-semibold")} />;
}
