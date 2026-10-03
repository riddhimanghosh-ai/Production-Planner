import Link from "next/link";
import type { ReactNode } from "react";
import { formatInr, monthLabel, ORDER_STATUS, PRODUCT_TYPES, type OrderStatus } from "@/lib/domain";
import type { BeanResult, CapacityResult, LineStopResult } from "@/lib/simulate";
import { buttonClass, Card, cx, Empty, Segmented, Stat, StatStrip, tbl } from "./ui";

export type Sim = "line" | "bean" | "capacity";
export type WhatIfParams = { sim: Sim; lineId: number; month: string; pct: number; productType: string; extraMt: number };

const SCENARIOS: { key: Sim; label: string; blurb: string }[] = [
  { key: "line", label: "A line stops", blurb: "A breakdown or long maintenance takes a line out for a month. Where do its orders go?" },
  { key: "bean", label: "Bean price moves", blurb: "Green bean prices rise or fall. Which open orders lose their margin?" },
  { key: "capacity", label: "More capacity", blurb: "A line gets more room for one product. What does it earn, and which waiting orders fit?" },
];

// What-if scenarios for the planner and COO. Plain GET forms; the page re-renders with the result. Nothing is saved.
export function WhatIf({ params, months, lines, result }: { params: WhatIfParams; months: string[]; lines: { id: number; code: string; productTypes: string[] }[]; result: LineStopResult | BeanResult | CapacityResult | null }) {
  const sc = SCENARIOS.find((x) => x.key === params.sim)!;
  const field = "block font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500";
  return (
    <div className="space-y-4">
      <Segmented active={params.sim} items={SCENARIOS.map((x) => ({ key: x.key, label: x.label, href: `/plan?tab=whatif&sim=${x.key}` }))} />
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card title="Scenario">
          <p className="mb-3 text-[13px] text-stone-600">{sc.blurb}</p>
          <form className="space-y-3">
            <input type="hidden" name="tab" value="whatif" />
            <input type="hidden" name="sim" value={params.sim} />
            {params.sim !== "bean" && (
              <label className="block">
                <span className={field}>Line</span>
                <select name="line" defaultValue={params.lineId} className="mt-1 w-full">
                  {lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {params.sim === "line" && (
              <label className="block">
                <span className={field}>Stops for the month of</span>
                <select name="month" defaultValue={params.month} className="mt-1 w-full">
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {params.sim === "bean" && (
              <label className="block">
                <span className={field}>Bean price change, %</span>
                <input name="pct" type="number" step="1" defaultValue={params.pct} className="mt-1 w-full" />
                <span className="mt-1 block text-[12px] text-stone-500">Use a minus sign for a fall. Applies to all origins.</span>
              </label>
            )}
            {params.sim === "capacity" && (
              <>
                <label className="block">
                  <span className={field}>Product</span>
                  <select name="product" defaultValue={params.productType} className="mt-1 w-full">
                    {Object.entries(PRODUCT_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={field}>Extra tonnes per month</span>
                  <input name="extra" type="number" step="1" min="1" defaultValue={params.extraMt} className="mt-1 w-full" />
                </label>
              </>
            )}
            <button type="submit" className={cx(buttonClass("primary"), "w-full")}>
              Run
            </button>
            <p className="text-[12px] text-stone-500">Reads the live plan. Nothing is changed or saved.</p>
          </form>
        </Card>
        <div className="min-w-0">
          {!result && <Empty>Pick a scenario and press Run.</Empty>}
          {result && params.sim === "line" && <LineStop r={result as LineStopResult} />}
          {result && params.sim === "bean" && <Bean r={result as BeanResult} />}
          {result && params.sim === "capacity" && <Capacity r={result as CapacityResult} />}
        </div>
      </div>
    </div>
  );
}

const t = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} t`;

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-700">{title}</div>
      {children}
    </section>
  );
}

function LineStop({ r }: { r: LineStopResult }) {
  const tone: Record<string, string> = { move: "text-emerald-700", late: "text-stone-900", partial: "text-red-700", risk: "text-red-700" };
  const word: Record<string, string> = { move: "Moves", late: "Runs late", partial: "Partly at risk", risk: "At risk" };
  return (
    <div className="space-y-4">
      <StatStrip>
        <Stat label="Orders affected" value={r.rows.length} hint={`${t(r.affectedMt)} planned on ${r.line} in ${monthLabel(r.month)}`} />
        <Stat label="Moves to another line" value={t(r.movedMt)} hint="Same month, no delay" tone={r.movedMt > 0 ? "green" : undefined} />
        <Stat label="Runs a month late" value={t(r.lateMt)} hint="Customer must agree" />
        <Stat label="At risk" value={t(r.riskMt)} hint={r.riskMt > 0 ? `${formatInr(r.revenueAtRisk)} of sales` : "Everything finds room"} tone={r.riskMt > 0 ? "red" : "green"} />
      </StatStrip>
      <Section title={`Orders on ${r.line} in ${monthLabel(r.month)}, approved first`}>
        {r.rows.length === 0 ? (
          <Empty>
            Nothing is planned on {r.line} in {monthLabel(r.month)}. The line would lose {t(r.capacityLost)} of capacity that could still be sold.
          </Empty>
        ) : (
          <div className={tbl.wrap}>
            <table className={cx(tbl.table, "min-w-[760px]")}>
              <thead>
                <tr>
                  <th className={tbl.th}>Order</th>
                  <th className={tbl.th}>Product</th>
                  <th className={tbl.thR}>Tonnes</th>
                  <th className={tbl.th}>Status</th>
                  <th className={tbl.th}>Outcome</th>
                  <th className={tbl.th}>Where it goes</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((x) => (
                  <tr key={x.ref} className={tbl.tr}>
                    <td className={tbl.td}>
                      <Link href={`/orders/${x.orderId}`} className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
                        {x.customer}
                      </Link>
                      <span className="ml-1.5 font-mono text-[11px] text-stone-500">{x.ref}</span>
                    </td>
                    <td className={cx(tbl.td, "text-stone-600")}>{x.product}</td>
                    <td className={tbl.tdR}>{x.qty.toLocaleString("en-IN")}</td>
                    <td className={cx(tbl.td, "text-stone-600")}>{ORDER_STATUS[x.status as OrderStatus] ?? x.status}</td>
                    <td className={cx(tbl.td, "font-semibold", tone[x.outcome])}>{word[x.outcome]}</td>
                    <td className={tbl.td}>{x.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <p className="text-[12px] text-stone-500">
        Moves use the free room each other line has for the same product in the same month; late runs use the month after. Space is given to approved orders first, then the largest. Use the calendar to make a move real.
      </p>
    </div>
  );
}

function Bean({ r }: { r: BeanResult }) {
  const diff = r.profitAfter - r.profitNow;
  return (
    <div className="space-y-4">
      <StatStrip>
        <Stat label="Orders exposed" value={r.exposed} hint={`${r.fixedCount} already fixed, not affected`} />
        <Stat label="Profit on open orders" value={formatInr(r.profitAfter)} hint={`now ${formatInr(r.profitNow)}`} />
        <Stat label="Change" value={`${diff > 0 ? "+" : ""}${formatInr(diff)}`} tone={diff < 0 ? "red" : "green"} hint={`bean price ${r.pct > 0 ? "+" : ""}${r.pct}%`} />
        <Stat label={`Below ${r.target}% margin`} value={r.belowAfter} hint={`now ${r.belowNow}`} tone={r.belowAfter > r.belowNow ? "red" : undefined} />
      </StatStrip>
      <Section title="Open orders, lowest margin after the change first">
        <div className={tbl.wrap}>
          <table className={cx(tbl.table, "min-w-[760px]")}>
            <thead>
              <tr>
                <th className={tbl.th}>Order</th>
                <th className={tbl.th}>Product</th>
                <th className={tbl.thR}>Tonnes</th>
                <th className={tbl.th}>Bean price</th>
                <th className={tbl.thR}>Margin now</th>
                <th className={tbl.thR}>Margin after</th>
                <th className={tbl.thR}>Profit change</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x) => {
                const d = x.profitAfter - x.profitNow;
                return (
                  <tr key={x.key} className={cx(tbl.tr, x.belowAfter && !x.fixed && "bg-red-50/40")}>
                    <td className={tbl.td}>
                      <Link href={`/orders/${x.orderId}`} className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
                        {x.customer}
                      </Link>
                      <span className="ml-1.5 font-mono text-[11px] text-stone-500">{x.ref}</span>
                    </td>
                    <td className={cx(tbl.td, "text-stone-600")}>{x.product}</td>
                    <td className={tbl.tdR}>{x.qty.toLocaleString("en-IN")}</td>
                    <td className={cx(tbl.td, x.fixed ? "text-emerald-700" : "text-stone-600")}>{x.fixed ? "Fixed" : "At market"}</td>
                    <td className={cx(tbl.tdR, x.now < r.target ? "text-red-700" : "")}>{x.now.toFixed(1)}%</td>
                    <td className={cx(tbl.tdR, "font-semibold", x.belowAfter ? "text-red-700" : "text-emerald-700")}>{x.after.toFixed(1)}%</td>
                    <td className={cx(tbl.tdR, d < 0 ? "text-red-700" : d > 0 ? "text-emerald-700" : "text-stone-400")}>{d === 0 ? "–" : `${d > 0 ? "+" : ""}${formatInr(d)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
      <p className="text-[12px] text-stone-500">Orders with a fixed bean price keep their margin. For the rest, fixing the price now (Inventory, Bean prices) removes this risk.</p>
    </div>
  );
}

function Capacity({ r }: { r: CapacityResult }) {
  const product = PRODUCT_TYPES[r.productType as keyof typeof PRODUCT_TYPES] ?? r.productType;
  const extraYear = r.extraMt * r.months.length;
  return (
    <div className="space-y-4">
      <StatStrip>
        <Stat label="Extra room" value={t(extraYear)} hint={`${t(r.extraMt)} a month over ${r.months.length} months`} />
        <Stat label="Extra profit a month" value={formatInr(r.profitPerMonth)} hint={`at ₹${Math.round(r.marginPerKg)}/kg, ${r.fromOrders ? "our average on " + product.toLowerCase() : "typical bulk order"}`} tone="green" />
        <Stat label="Extra profit a year" value={formatInr(r.profitPerMonth * r.months.length)} hint="If the room is sold" />
        <Stat label="Waiting orders that now fit" value={r.placeable.length} hint={r.placeable.length ? r.placeable.map((p) => p.customer).join(", ") : "None waiting for this product"} />
      </StatStrip>
      {!r.makesToday && (
        <p className="border border-stone-300 border-l-[3px] border-l-stone-900 bg-white px-3 py-2 text-[13px]">
          {r.line} does not make {product.toLowerCase()} today. Adding it means changeover time whenever the line runs two products in one month; see Line setup.
        </p>
      )}
      <Section title={`Free room for ${product.toLowerCase()} on ${r.line}, month by month`}>
        <div className={tbl.wrap}>
          <table className={tbl.table}>
            <thead>
              <tr>
                <th className={tbl.th}>Month</th>
                <th className={tbl.thR}>Free now</th>
                <th className={tbl.thR}>Free after</th>
                <th className={tbl.th}>Sellable</th>
              </tr>
            </thead>
            <tbody>
              {r.months.map((m) => (
                <tr key={m.month} className={tbl.tr}>
                  <td className={cx(tbl.td, "font-medium")}>{monthLabel(m.month)}</td>
                  <td className={tbl.tdR}>{t(m.freeNow)}</td>
                  <td className={cx(tbl.tdR, "font-semibold text-emerald-700")}>{t(m.freeAfter)}</td>
                  <td className={tbl.td}>
                    <div className="h-1.5 w-full max-w-64 bg-stone-200">
                      <div className="h-1.5 bg-emerald-600" style={{ width: `${Math.min(100, (m.freeAfter / Math.max(1, Math.max(...r.months.map((x) => x.freeAfter)))) * 100)}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      {r.placeable.length > 0 && (
        <Section title="Waiting orders that would fit with this room">
          <div className={tbl.wrap}>
            <table className={tbl.table}>
              <thead>
                <tr>
                  <th className={tbl.th}>Order</th>
                  <th className={tbl.th}>Product</th>
                  <th className={tbl.thR}>Tonnes</th>
                  <th className={tbl.th}>Ships</th>
                </tr>
              </thead>
              <tbody>
                {r.placeable.map((p) => (
                  <tr key={p.ref} className={tbl.tr}>
                    <td className={tbl.td}>
                      <span className="font-medium">{p.customer}</span> <span className="ml-1 font-mono text-[11px] text-stone-500">{p.ref}</span>
                    </td>
                    <td className={cx(tbl.td, "text-stone-600")}>{p.product}</td>
                    <td className={tbl.tdR}>{p.slotMt.toLocaleString("en-IN")}</td>
                    <td className={tbl.td}>{monthLabel(p.month)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      <p className="text-[12px] text-stone-500">Profit uses the average margin per kg on our current orders for this product. To make the change real, update the line in Line setup.</p>
    </div>
  );
}
