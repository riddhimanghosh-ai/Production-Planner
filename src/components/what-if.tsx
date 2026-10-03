"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { formatInr, monthLabel, PRODUCT_TYPES } from "@/lib/domain";
import type { LineStopResult, PlaygroundData } from "@/lib/simulate";
import { cx } from "./ui";

type Sim = "line" | "bean" | "capacity";

const SCENARIOS: { key: Sim; title: string; blurb: string }[] = [
  { key: "line", title: "A line stops", blurb: "Breakdown or long maintenance for a month" },
  { key: "bean", title: "Bean price moves", blurb: "Green beans get dearer or cheaper" },
  { key: "capacity", title: "More capacity", blurb: "A line gets extra room for one product" },
];

// The What-if playground. Rounded cards and sliders, by request; everything updates as you drag.
// All numbers are precomputed on the server (see playgroundData) and nothing here is saved.
export function WhatIfPlayground({ data }: { data: PlaygroundData }) {
  const [sim, setSim] = useState<Sim>("line");
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {SCENARIOS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSim(s.key)}
            className={cx("rounded-[14px] border p-4 text-left transition-colors", sim === s.key ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white hover:border-stone-900")}
          >
            <div className="text-[15px] font-semibold">{s.title}</div>
            <div className={cx("mt-0.5 text-[12px]", sim === s.key ? "text-white/70" : "text-stone-500")}>{s.blurb}</div>
          </button>
        ))}
      </div>
      {sim === "line" && <LineStop data={data} />}
      {sim === "bean" && <Bean data={data} />}
      {sim === "capacity" && <Capacity data={data} />}
      <p className="text-[12px] text-stone-500">A playground: it reads the live plan and changes nothing. Make a change real from the calendar, Line setup or Inventory.</p>
    </div>
  );
}

const t = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} t`;

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-[14px] border border-stone-300 bg-white p-4", className)}>{children}</div>;
}

function Label({ children }: { children: ReactNode }) {
  return <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">{children}</div>;
}

function Chips<K extends string | number>({ items, value, onChange }: { items: { key: K; label: string; muted?: boolean }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <button
          key={String(i.key)}
          type="button"
          onClick={() => onChange(i.key)}
          className={cx(
            "h-8 rounded-full border px-3 text-[13px] font-medium transition-colors",
            i.key === value ? "border-stone-900 bg-stone-900 text-white" : i.muted ? "border-stone-200 text-stone-400 hover:border-stone-400" : "border-stone-300 bg-white text-stone-700 hover:border-stone-900",
          )}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

function Slider({ value, min, max, step = 1, onChange, format, marks }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format: (v: number) => string; marks?: string[] }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="tabular text-[28px] font-medium leading-none tracking-[-0.03em] text-stone-900">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-brand-600" />
      {marks && (
        <div className="flex justify-between font-mono text-[10px] text-stone-400">
          {marks.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function Big({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "red" | "green" }) {
  return (
    <Panel className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">{label}</div>
      <div className={cx("tabular mt-2 text-[28px] font-normal leading-none tracking-[-0.035em]", tone === "red" ? "text-red-700" : tone === "green" ? "text-emerald-700" : "text-stone-900")}>{value}</div>
      {hint && <div className="mt-1.5 text-[12px] leading-snug text-stone-500">{hint}</div>}
    </Panel>
  );
}

function OrderName({ orderId, customer, refNo }: { orderId: number; customer: string; refNo: string }) {
  return (
    <div className="min-w-0 truncate">
      <Link href={`/orders/${orderId}`} className="font-medium text-stone-900 hover:text-brand-600">
        {customer}
      </Link>
      <span className="ml-1.5 font-mono text-[11px] text-stone-500">{refNo}</span>
    </div>
  );
}

// 1. A line stops: pick the line with chips, slide through the months.
function LineStop({ data }: { data: PlaygroundData }) {
  const [lineId, setLineId] = useState(data.lines[0].id);
  const [mi, setMi] = useState(() => {
    // Start on the busiest month of the first line so the first view has something to say.
    let best = 0;
    data.months.forEach((m, i) => {
      if ((data.lineStop[`${data.lines[0].id}|${m}`]?.affectedMt ?? 0) > (data.lineStop[`${data.lines[0].id}|${data.months[best]}`]?.affectedMt ?? 0)) best = i;
    });
    return best;
  });
  const month = data.months[mi];
  const r: LineStopResult = data.lineStop[`${lineId}|${month}`];
  const tone: Record<string, string> = { move: "border-l-emerald-600", late: "border-l-stone-900", partial: "border-l-red-600", risk: "border-l-red-600" };
  const word: Record<string, [string, string]> = { move: ["Moves", "text-emerald-700"], late: ["Runs late", "text-stone-900"], partial: ["Partly at risk", "text-red-700"], risk: ["At risk", "text-red-700"] };
  return (
    <div className="space-y-4">
      <Panel>
        <div className="grid gap-5 md:grid-cols-[auto_1fr]">
          <div>
            <Label>Which line stops</Label>
            <Chips items={data.lines.map((l) => ({ key: l.id, label: l.code }))} value={lineId} onChange={setLineId} />
          </div>
          <div>
            <Label>For the whole month of</Label>
            <Slider
              value={mi}
              min={0}
              max={data.months.length - 1}
              onChange={setMi}
              format={(i) => monthLabel(data.months[i])}
              marks={[monthLabel(data.months[0], false), monthLabel(data.months[Math.floor(data.months.length / 2)], false), monthLabel(data.months.at(-1)!, false)]}
            />
          </div>
        </div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Big label="Orders affected" value={r.rows.length} hint={`${t(r.affectedMt)} planned on ${r.line}`} />
        <Big label="Moves to another line" value={t(r.movedMt)} hint="Same month, no delay" tone={r.movedMt > 0 ? "green" : undefined} />
        <Big label="Runs a month late" value={t(r.lateMt)} hint="Customer must agree" />
        <Big label="At risk" value={t(r.riskMt)} hint={r.riskMt > 0 ? `${formatInr(r.revenueAtRisk)} of sales` : "Everything finds room"} tone={r.riskMt > 0 ? "red" : "green"} />
      </div>
      {r.rows.length === 0 ? (
        <Panel className="text-[13px] text-stone-600">
          Nothing is planned on {r.line} in {monthLabel(month)}. The stop would cost {t(r.capacityLost)} of capacity that could still have been sold.
        </Panel>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {r.rows.map((x) => (
            <div key={x.ref} className={cx("rounded-[14px] border border-stone-300 border-l-4 bg-white p-4", tone[x.outcome])}>
              <div className="flex items-start justify-between gap-3">
                <OrderName orderId={x.orderId} customer={x.customer} refNo={x.ref} />
                <span className={cx("shrink-0 text-[13px] font-semibold", word[x.outcome][1])}>{word[x.outcome][0]}</span>
              </div>
              <div className="mt-1 text-[12px] text-stone-500">
                {x.product} · {x.qty.toLocaleString("en-IN")} t · {x.status === "COMMITTED" ? "Approved" : "Waiting for approval"}
              </div>
              <div className="mt-3 text-[13px] text-stone-900">{x.to}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 2. Bean price: one slider, every open order re-priced as you drag.
function Bean({ data }: { data: PlaygroundData }) {
  const [pct, setPct] = useState(15);
  const target = data.bean.target;
  const rows = data.bean.rows
    .map((x) => {
      const costAfter = x.fixed ? x.costKg : x.costKg + x.beanKg * (pct / 100);
      const now = ((x.priceKg - x.costKg) / x.priceKg) * 100;
      const after = ((x.priceKg - costAfter) / x.priceKg) * 100;
      return { ...x, now, after, profitNow: (x.priceKg - x.costKg) * x.qty * 1000, profitAfter: (x.priceKg - costAfter) * x.qty * 1000 };
    })
    .sort((a, b) => a.after - b.after);
  const profitNow = rows.reduce((a, r) => a + r.profitNow, 0);
  const profitAfter = rows.reduce((a, r) => a + r.profitAfter, 0);
  const belowNow = rows.filter((r) => r.now < target).length;
  const belowAfter = rows.filter((r) => r.after < target).length;
  const exposed = rows.filter((r) => !r.fixed).length;
  const diff = profitAfter - profitNow;
  const scale = Math.max(30, ...rows.map((r) => Math.max(r.now, r.after)));
  return (
    <div className="space-y-4">
      <Panel>
        <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <Label>Green bean price, all origins</Label>
            <Slider value={pct} min={-30} max={50} onChange={setPct} format={(v) => `${v > 0 ? "+" : ""}${v}%`} marks={["-30%", "0", "+50%"]} />
          </div>
          <Chips items={[-10, 0, 10, 20, 30].map((v) => ({ key: v, label: `${v > 0 ? "+" : ""}${v}%` }))} value={pct} onChange={setPct} />
        </div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Big label="Orders exposed" value={exposed} hint={`${rows.length - exposed} already fixed, not affected`} />
        <Big label="Profit on open orders" value={formatInr(profitAfter)} hint={`now ${formatInr(profitNow)}`} />
        <Big label="Change" value={`${diff > 0 ? "+" : ""}${formatInr(diff)}`} tone={diff < 0 ? "red" : "green"} hint={`bean price ${pct > 0 ? "+" : ""}${pct}%`} />
        <Big label={`Below ${target}% margin`} value={belowAfter} hint={`now ${belowNow}`} tone={belowAfter > belowNow ? "red" : belowAfter < belowNow ? "green" : undefined} />
      </div>
      <Panel className="p-0">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-700">Open orders, lowest margin after first</div>
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-stone-500">
            <span className="flex items-center gap-1">
              <span className="h-2 w-3 bg-stone-300" /> now
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-3 bg-stone-900" /> after
            </span>
          </div>
        </div>
        <div className="divide-y divide-stone-200">
          {rows.map((x) => (
            <div key={x.key} className="grid items-center gap-3 px-4 py-2.5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]">
              <div className="min-w-0">
                <OrderName orderId={x.orderId} customer={x.customer} refNo={x.ref} />
                <div className="truncate text-[12px] text-stone-500">
                  {x.product} · {x.qty.toLocaleString("en-IN")} t · {x.fixed ? <span className="text-emerald-700">bean price fixed</span> : "at market"}
                </div>
              </div>
              <div className="relative h-6">
                <div className="absolute inset-y-0 border-l border-dashed border-stone-400" style={{ left: `${(target / scale) * 100}%` }} title={`${target}% minimum`} />
                <div className="absolute left-0 top-0 h-2.5 bg-stone-300" style={{ width: `${(Math.max(0, x.now) / scale) * 100}%` }} />
                <div className={cx("absolute bottom-0 left-0 h-2.5 transition-all", x.after < target ? "bg-red-600" : "bg-stone-900")} style={{ width: `${(Math.max(0, x.after) / scale) * 100}%` }} />
              </div>
              <div className="tabular whitespace-nowrap text-right text-[13px]">
                <span className="text-stone-500">{x.now.toFixed(1)}%</span>
                <span className="mx-1.5 text-stone-400">→</span>
                <span className={cx("font-semibold", x.after < target ? "text-red-700" : "text-emerald-700")}>{x.after.toFixed(1)}%</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// 3. More capacity: pick line and product, slide the extra tonnes.
function Capacity({ data }: { data: PlaygroundData }) {
  const [lineId, setLineId] = useState(data.lines[0].id);
  const line = data.lines.find((l) => l.id === lineId)!;
  const [pt, setPt] = useState(line.productTypes[0]);
  const [extra, setExtra] = useState(10);
  const product = PRODUCT_TYPES[pt as keyof typeof PRODUCT_TYPES] ?? pt;
  const makes = line.productTypes.includes(pt);
  const months = data.months.map((m) => {
    const freeNow = data.capacity.freeNow[`${lineId}|${pt}|${m}`] ?? 0;
    return { month: m, freeNow, freeAfter: freeNow + extra };
  });
  const margin = data.capacity.perKg[pt];
  const profitMonth = extra * 1000 * (margin?.perKg ?? 0);
  const fits = data.capacity.waiting.filter((w) => {
    const c = months.find((m) => m.month === w.month);
    return w.productType === pt && c && w.slotMt > c.freeNow + 0.05 && w.slotMt <= c.freeAfter + 0.05;
  });
  const max = Math.max(1, ...months.map((m) => m.freeAfter));
  return (
    <div className="space-y-4">
      <Panel>
        <div className="grid gap-5 md:grid-cols-[auto_auto_1fr]">
          <div>
            <Label>Line</Label>
            <Chips
              items={data.lines.map((l) => ({ key: l.id, label: l.code }))}
              value={lineId}
              onChange={(id) => {
                setLineId(id);
                const l = data.lines.find((x) => x.id === id)!;
                if (!l.productTypes.includes(pt)) setPt(l.productTypes[0]);
              }}
            />
          </div>
          <div>
            <Label>Product</Label>
            <Chips items={Object.entries(PRODUCT_TYPES).map(([k, v]) => ({ key: k, label: v, muted: !line.productTypes.includes(k) }))} value={pt} onChange={setPt} />
          </div>
          <div>
            <Label>Extra tonnes a month</Label>
            <Slider value={extra} min={5} max={40} step={5} onChange={setExtra} format={(v) => `+${v} t`} marks={["5 t", "20 t", "40 t"]} />
          </div>
        </div>
      </Panel>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Big label="Extra room a year" value={t(extra * months.length)} hint={`${t(extra)} a month over ${months.length} months`} />
        <Big label="Extra profit a month" value={formatInr(profitMonth)} hint={`at ₹${Math.round(margin?.perKg ?? 0)}/kg, ${margin?.fromOrders ? `our average on ${product.toLowerCase()}` : "typical bulk order"}`} tone="green" />
        <Big label="Extra profit a year" value={formatInr(profitMonth * months.length)} hint="If the room is sold" />
        <Big label="Waiting orders that now fit" value={fits.length} hint={fits.length ? fits.map((f) => `${f.customer}, ${f.slotMt} t`).join("; ") : "None waiting for this product"} tone={fits.length ? "green" : undefined} />
      </div>
      {!makes && (
        <Panel className="border-l-4 border-l-stone-900 text-[13px]">
          {line.code} does not make {product.toLowerCase()} today. Adding it means changeover time whenever the line runs two products in one month; see Line setup.
        </Panel>
      )}
      <Panel className="p-0">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-700">
            Free room for {product.toLowerCase()} on {line.code}
          </div>
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-stone-500">
            <span className="flex items-center gap-1">
              <span className="h-2 w-3 bg-stone-300" /> now
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-3 bg-emerald-600" /> extra
            </span>
          </div>
        </div>
        <div className="divide-y divide-stone-200">
          {months.map((m) => (
            <div key={m.month} className="grid grid-cols-[72px_1fr_auto] items-center gap-3 px-4 py-2">
              <div className="text-[13px] font-medium">{monthLabel(m.month, false)}</div>
              <div className="flex h-2.5 w-full">
                <div className="h-full bg-stone-300" style={{ width: `${(m.freeNow / max) * 100}%` }} />
                <div className="h-full bg-emerald-600 transition-all" style={{ width: `${(extra / max) * 100}%` }} />
              </div>
              <div className="tabular whitespace-nowrap text-right text-[13px]">
                <span className="text-stone-500">{t(m.freeNow)}</span>
                <span className="mx-1.5 text-stone-400">→</span>
                <span className="font-semibold text-emerald-700">{t(m.freeAfter)}</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
