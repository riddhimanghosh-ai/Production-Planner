"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { addMonths, formatInr, monthLabel, PRODUCT_TYPES } from "@/lib/domain";
import type { PlaygroundData, PlannedOrder } from "@/lib/simulate";
import { cx } from "./ui";

// One playground. Change the line setup, stop a line for a month, move the bean price: every number on the
// page is recomputed from the live plan as you drag. Rounded cards and sliders, by request; nothing is saved.

const t = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} t`;
const pname = (pt: string) => PRODUCT_TYPES[pt as keyof typeof PRODUCT_TYPES] ?? pt;
type Caps = Record<string, Record<string, number>>;
type Stops = Record<string, string | null>; // lineId -> month it stops in, or null
type Outcome = { o: PlannedOrder; from: string; month: string; outcome: "move" | "late" | "risk"; to: string };

export function WhatIfPlayground({ data }: { data: PlaygroundData }) {
  const pts = Object.keys(PRODUCT_TYPES);
  const [caps, setCaps] = useState<Caps>(() => JSON.parse(JSON.stringify(data.caps)));
  const [stops, setStops] = useState<Stops>(() => Object.fromEntries(data.lines.map((l) => [l.id, null])));
  const [pct, setPct] = useState(0);
  const today = data.caps;

  // Capacity of a cell under the scenario: the slider value, or nothing in a stopped month.
  const cap = (c: Caps, st: Stops, lineId: number, pt: string, m: string) => (st[lineId] === m ? 0 : (c[lineId]?.[pt] ?? 0));
  const total = (c: Caps) => data.lines.reduce((a, l) => a + pts.reduce((b, p) => b + (c[l.id]?.[p] ?? 0), 0), 0);
  const profit = (c: Caps) => data.lines.reduce((a, l) => a + pts.reduce((b, p) => b + (c[l.id]?.[p] ?? 0) * 1000 * (data.perKg[p]?.perKg ?? 0), 0), 0);

  // 1. Planned orders that no longer fit, and where they could go. Approved orders keep their place first.
  const claimed: Record<string, number> = {};
  const room = (lineId: number, pt: string, m: string) => cap(caps, stops, lineId, pt, m) - (data.load[`${lineId}|${pt}|${m}`] ?? 0) - (claimed[`${lineId}|${pt}|${m}`] ?? 0);
  const displaced: Outcome[] = [];
  for (const l of data.lines)
    for (const p of pts)
      for (const m of data.months) {
        let over = (data.load[`${l.id}|${p}|${m}`] ?? 0) - cap(caps, stops, l.id, p, m);
        if (over <= 0.05) continue;
        // Smallest, unapproved orders lose their slot first.
        const cell = [...(data.orders[`${l.id}|${p}|${m}`] ?? [])].sort((a, b) => Number(a.status === "COMMITTED") - Number(b.status === "COMMITTED") || a.qty - b.qty);
        for (const o of cell) {
          if (over <= 0.05) break;
          over -= o.qty;
          const same = data.lines
            .filter((x) => x.id !== l.id)
            .map((x) => ({ x, free: room(x.id, p, m) }))
            .filter((c) => c.free >= o.qty - 0.05)
            .sort((a, b) => b.free - a.free)[0];
          if (same) {
            claimed[`${same.x.id}|${p}|${m}`] = (claimed[`${same.x.id}|${p}|${m}`] ?? 0) + o.qty;
            displaced.push({ o, from: l.code, month: m, outcome: "move", to: `${same.x.code}, ${monthLabel(m)}` });
            continue;
          }
          const next = addMonths(m, 1);
          const later = data.lines
            .map((x) => ({ x, free: room(x.id, p, next) }))
            .filter((c) => c.free >= o.qty - 0.05)
            .sort((a, b) => b.free - a.free)[0];
          if (later) {
            claimed[`${later.x.id}|${p}|${next}`] = (claimed[`${later.x.id}|${p}|${next}`] ?? 0) + o.qty;
            displaced.push({ o, from: l.code, month: m, outcome: "late", to: `${later.x.code}, ${monthLabel(next)} (a month late)` });
            continue;
          }
          displaced.push({ o, from: l.code, month: m, outcome: "risk", to: "No room on any line" });
        }
      }
  const movedMt = displaced.filter((d) => d.outcome === "move").reduce((a, d) => a + d.o.qty, 0);
  const lateMt = displaced.filter((d) => d.outcome === "late").reduce((a, d) => a + d.o.qty, 0);
  const risk = displaced.filter((d) => d.outcome === "risk");
  const riskMt = risk.reduce((a, d) => a + d.o.qty, 0);
  const riskInr = risk.reduce((a, d) => a + d.o.revenue, 0);

  // 2. Waiting orders that fit under the scenario but not today.
  const fitsIn = (c: Caps, st: Stops, w: PlaygroundData["waiting"][number]) => data.lines.some((l) => cap(c, st, l.id, w.productType, w.month) - (data.load[`${l.id}|${w.productType}|${w.month}`] ?? 0) >= w.slotMt - 0.05);
  const noStops: Stops = Object.fromEntries(data.lines.map((l) => [l.id, null]));
  const newlyFit = data.waiting.filter((w) => fitsIn(caps, stops, w) && !fitsIn(today, noStops, w));

  // 3. Bean price: re-price every open order.
  const target = data.bean.target;
  const beanRows = data.bean.rows
    .map((x) => {
      const costAfter = x.fixed ? x.costKg : x.costKg + x.beanKg * (pct / 100);
      const now = ((x.priceKg - x.costKg) / x.priceKg) * 100;
      const after = ((x.priceKg - costAfter) / x.priceKg) * 100;
      return { ...x, now, after, profitNow: (x.priceKg - x.costKg) * x.qty * 1000, profitAfter: (x.priceKg - costAfter) * x.qty * 1000 };
    })
    .sort((a, b) => a.after - b.after);
  const profitNow = beanRows.reduce((a, r) => a + r.profitNow, 0);
  const profitAfter = beanRows.reduce((a, r) => a + r.profitAfter, 0);
  const beanDiff = profitAfter - profitNow;
  const belowNow = beanRows.filter((r) => r.now < target).length;
  const belowAfter = beanRows.filter((r) => r.after < target).length;
  const scale = Math.max(30, ...beanRows.map((r) => Math.max(r.now, r.after)));

  const setupChanged = JSON.stringify(caps) !== JSON.stringify(today);
  const stopped = data.lines.filter((l) => stops[l.id]);
  const changed = setupChanged || stopped.length > 0 || pct !== 0;
  const dTotal = total(caps) - total(today);
  const dProfit = profit(caps) - profit(today);
  const added = data.lines.flatMap((l) => pts.filter((p) => (caps[l.id]?.[p] ?? 0) > 0 && (today[l.id]?.[p] ?? 0) === 0).map((p) => `${pname(p).toLowerCase()} on ${l.code}`));
  const reset = () => {
    setCaps(JSON.parse(JSON.stringify(today)));
    setStops(noStops);
    setPct(0);
  };
  const word: Record<Outcome["outcome"], [string, string, string]> = { move: ["Moves", "text-emerald-700", "border-l-emerald-600"], late: ["Runs late", "text-stone-900", "border-l-stone-900"], risk: ["At risk", "text-red-700", "border-l-red-600"] };

  return (
    <div className="space-y-4">
      {/* Results first: they follow the controls below as you drag. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Big label="Capacity a month" value={t(total(caps))} hint={setupChanged ? `${dTotal >= 0 ? "+" : ""}${t(dTotal)} vs today` : "Today's setup"} tone={dTotal > 0 ? "green" : dTotal < 0 ? "red" : undefined} />
        <Big
          label="Profit a month at full load"
          value={formatInr(profit(caps))}
          hint={setupChanged ? `${dProfit >= 0 ? "+" : ""}${formatInr(dProfit)} vs today` : "If every line runs full"}
          tone={dProfit > 0 ? "green" : dProfit < 0 ? "red" : undefined}
        />
        <Big
          label="Planned orders displaced"
          value={displaced.length}
          hint={displaced.length ? `${t(movedMt)} move, ${t(lateMt)} late, ${t(riskMt)} at risk` : "Everything planned still fits"}
          tone={riskMt > 0 ? "red" : displaced.length ? undefined : "green"}
        />
        <Big label="Sales at risk" value={formatInr(riskInr)} hint={riskMt > 0 ? `${t(riskMt)} with no room anywhere` : "Nothing at risk"} tone={riskMt > 0 ? "red" : "green"} />
        <Big
          label="Open-order profit"
          value={`${beanDiff > 0 ? "+" : ""}${formatInr(beanDiff)}`}
          hint={pct === 0 ? "Bean price unchanged" : `${belowAfter} below ${target}% (now ${belowNow})`}
          tone={beanDiff < 0 ? "red" : beanDiff > 0 ? "green" : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={reset} disabled={!changed} className="h-8 rounded-full border border-stone-300 bg-white px-3 text-[13px] font-medium text-stone-700 hover:border-stone-900 disabled:opacity-40">
          Reset everything
        </button>
        <Link href="/capacity" className="h-8 rounded-full border border-stone-900 bg-stone-900 px-3 text-[13px] font-medium leading-8 text-white hover:border-brand-600 hover:bg-brand-600">
          Make the line setup real
        </Link>
        {newlyFit.length > 0 && <span className="text-[13px] text-emerald-700">Waiting orders that now fit: {newlyFit.map((f) => `${f.customer}, ${f.slotMt} t`).join("; ")}</span>}
      </div>

      {/* Controls: one card per line, then the bean price. */}
      <div className="grid gap-3 md:grid-cols-2">
        {data.lines.map((l) => {
          const lineTotal = pts.reduce((a, p) => a + (caps[l.id]?.[p] ?? 0), 0);
          const lineToday = pts.reduce((a, p) => a + (today[l.id]?.[p] ?? 0), 0);
          const stop = stops[l.id];
          return (
            <Panel key={l.id} className={cx(stop && "border-red-300")}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[15px] font-semibold">{l.code}</div>
                <div className="tabular text-[13px] text-stone-500">
                  <span className="font-semibold text-stone-900">{t(lineTotal)}</span> a month{lineTotal !== lineToday && <span className="ml-1.5 text-stone-400">(today {t(lineToday)})</span>}
                </div>
              </div>
              <div className="space-y-3">
                {pts.map((p) => {
                  const v = caps[l.id]?.[p] ?? 0;
                  const was = today[l.id]?.[p] ?? 0;
                  const maxLoad = Math.max(0, ...data.months.map((m) => data.load[`${l.id}|${p}|${m}`] ?? 0));
                  return (
                    <div key={p} className="grid grid-cols-[104px_1fr_56px] items-center gap-3">
                      <div className={cx("text-[13px]", v === 0 ? "text-stone-400" : "text-stone-900")}>{pname(p)}</div>
                      <div className="relative">
                        <input
                          type="range"
                          min={0}
                          max={60}
                          step={5}
                          value={v}
                          onChange={(e) => setCaps((c) => ({ ...c, [l.id]: { ...c[l.id], [p]: Number(e.target.value) } }))}
                          className="w-full accent-brand-600"
                          aria-label={`${l.code} ${pname(p)} tonnes a month`}
                        />
                        {maxLoad > 0 && <div className="pointer-events-none absolute -bottom-1 h-1 w-px bg-red-600" style={{ left: `${Math.min(100, (maxLoad / 60) * 100)}%` }} title={`Busiest month has ${t(maxLoad)} planned`} />}
                      </div>
                      <div className={cx("tabular text-right text-[13px] font-semibold", v < maxLoad - 0.05 ? "text-red-700" : v !== was ? "text-brand-600" : "text-stone-900")}>{t(v)}</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">Stops for a month</span>
                <select
                  value={stop ?? ""}
                  onChange={(e) => setStops((s) => ({ ...s, [l.id]: e.target.value || null }))}
                  className={cx("h-8 rounded-full border bg-white px-3 text-[13px]", stop ? "border-red-600 text-red-700" : "border-stone-300 text-stone-700")}
                  aria-label={`${l.code} stops in`}
                >
                  <option value="">Running normally</option>
                  {data.months.map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                    </option>
                  ))}
                </select>
              </div>
            </Panel>
          );
        })}
        <Panel className="md:col-span-2">
          <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">Green bean price, all origins</div>
              <div className="tabular mb-1 text-[28px] font-medium leading-none tracking-[-0.03em] text-stone-900">{`${pct > 0 ? "+" : ""}${pct}%`}</div>
              <input type="range" min={-30} max={50} step={1} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="w-full accent-brand-600" aria-label="Bean price change" />
              <div className="flex justify-between font-mono text-[10px] text-stone-400">
                <span>-30%</span>
                <span>0</span>
                <span>+50%</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[-10, 0, 10, 20, 30].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPct(v)}
                  className={cx("h-8 rounded-full border px-3 text-[13px] font-medium transition-colors", v === pct ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-700 hover:border-stone-900")}
                >
                  {v > 0 ? "+" : ""}
                  {v}%
                </button>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      {added.length > 0 && <Panel className="border-l-4 border-l-stone-900 text-[13px]">New on a line: {added.join(", ")}. Check the equipment can make it, and expect changeover time when two products run in one month.</Panel>}

      {/* Detail: what happens to planned orders, and to margins. */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-0">
          <div className="border-b border-stone-200 px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-700">Planned orders that lose their slot</div>
          {displaced.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-stone-500">None. Everything planned still fits this setup{stopped.length ? " even with the stop" : ""}.</p>
          ) : (
            <div className="divide-y divide-stone-200">
              {displaced.map((d) => (
                <div key={`${d.o.ref}-${d.month}`} className={cx("grid gap-3 border-l-4 px-4 py-2.5 md:grid-cols-[minmax(0,1fr)_auto]", word[d.outcome][2])}>
                  <div className="min-w-0">
                    <OrderName orderId={d.o.orderId} customer={d.o.customer} refNo={d.o.ref} />
                    <div className="truncate text-[12px] text-stone-500">
                      {d.o.product} · {d.o.qty.toLocaleString("en-IN")} t · was {d.from}, {monthLabel(d.month)}
                    </div>
                  </div>
                  <div className="text-right text-[13px]">
                    <div className={cx("font-semibold", word[d.outcome][1])}>{word[d.outcome][0]}</div>
                    <div className="text-stone-600">{d.to}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel className="p-0">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-700">Margins on open orders, lowest first</div>
            <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-stone-500">
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 bg-stone-300" /> now
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 bg-stone-900" /> after
              </span>
            </div>
          </div>
          <div className="max-h-[520px] divide-y divide-stone-200 overflow-y-auto">
            {beanRows.map((x) => (
              <div key={x.key} className="grid items-center gap-3 px-4 py-2 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]">
                <div className="min-w-0">
                  <OrderName orderId={x.orderId} customer={x.customer} refNo={x.ref} />
                  <div className="truncate text-[12px] text-stone-500">
                    {x.qty.toLocaleString("en-IN")} t · {x.fixed ? <span className="text-emerald-700">bean price fixed</span> : "at market"}
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
      <p className="text-[12px] text-stone-500">
        A playground: it reads the live plan and changes nothing. The red tick under a slider is the busiest planned month for that product; below it, planned orders lose their slot. Displaced orders look for room on another line in the same month
        first, then the month after. Profit at full load uses the average margin per kg on current orders for each product.
      </p>
    </div>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-[14px] border border-stone-300 bg-white p-4", className)}>{children}</div>;
}

function Big({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "red" | "green" }) {
  return (
    <Panel className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">{label}</div>
      <div className={cx("tabular mt-2 text-[26px] font-normal leading-none tracking-[-0.035em]", tone === "red" ? "text-red-700" : tone === "green" ? "text-emerald-700" : "text-stone-900")}>{value}</div>
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
