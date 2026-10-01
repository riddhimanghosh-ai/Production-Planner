"use client";

import Link from "next/link";
import { Fragment, useActionState, useState, useTransition, type ReactNode } from "react";
import { dismissRequestAction, gbClosureAction, purchaseOrderAction, receiveAction, saveBeanPrices } from "@/app/actions";
import { currentMonth, monthLabel, ORIGINS, type Origin } from "@/lib/domain";
import { ExportButton } from "./export-button";
import { buttonClass, Card, cx, tbl } from "./ui";

type Row = {
  key: string;
  group: string;
  name: string;
  unit: string;
  onHand: number;
  onOrder: number;
  leadDays?: number;
  cells: Record<string, StockCell>;
};
type StockCell = {
  need: number;
  arriving: number;
  available: number;
  balanceAfter: number;
  short: number;
  orders: { orderId: number; ref: string; customer: string; status: string; line: string; quantity: number }[];
  pos: { id: number; quantity: number; supplier: string }[];
};
type Attention = {
  id: string;
  requestId: number | null;
  key: string;
  name: string;
  unit: string;
  month: string;
  quantity: number;
  earliestArrival: string;
  leadDays: number;
  source: string;
  orders: { ref: string; customer: string; orderId: number }[];
  supplier: string;
};
type PO = {
  id: number;
  name: string;
  unit: string;
  quantity: number;
  arrivalMonth: string;
  supplier: string;
};

const fmt = (n: number, unit: string) =>
  unit === "kg" ? `${(n / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} t` : n >= 1000 ? `${(n / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}k ${unit}` : `${Math.round(n).toLocaleString("en-IN")} ${unit}`;
const WINDOW = 8;

export function InventoryBoard({
  months,
  rows,
  attention,
  purchaseOrders,
  openGb,
  beanPrices,
  canBuy,
  canPrice,
}: {
  months: string[];
  rows: Row[];
  attention: Attention[];
  purchaseOrders: PO[];
  openGb: {
    orderId: number;
    ref: string;
    customer: string;
    origin: string;
    grade: string;
    market: number;
    beanT: number;
    firstMonth: string;
    approved: boolean;
  }[];
  beanPrices: { key: string; value: number }[];
  canBuy: boolean;
  canPrice: boolean;
}) {
  const [start, setStart] = useState(0);
  const shown = months.slice(start, start + WINDOW);
  const shortRows = rows.filter((r) => Object.values(r.cells).some((c) => c.short > 0.5));
  const [tab, setTab] = useState<"attention" | "stock" | "pos" | "beans">(attention.length ? "attention" : "stock");

  const exportRows = [
    ["Material", "Unit", "In stock", "On the way", ...months.flatMap((m) => [`${monthLabel(m)} use`, `${monthLabel(m)} left`])],
    ...rows.map((r) => [
      r.name,
      r.unit === "kg" ? "tonnes" : r.unit,
      r.unit === "kg" ? r.onHand / 1000 : r.onHand,
      r.unit === "kg" ? r.onOrder / 1000 : r.onOrder,
      ...months.flatMap((m) => [r.unit === "kg" ? r.cells[m].need / 1000 : r.cells[m].need, r.unit === "kg" ? r.cells[m].balanceAfter / 1000 : r.cells[m].balanceAfter]),
    ]),
  ];

  return (
    <div className="space-y-3">
      <div className="flex border-b border-stone-300">
        {(
          [
            ["attention", "Needs attention", attention.length, attention.length ? "red" : ""],
            ["stock", "Stock & coverage", shortRows.length, shortRows.length ? "red" : ""],
            ["pos", "Purchases on the way", purchaseOrders.length, ""],
            ["beans", "Bean prices", openGb.length, openGb.length ? "amber" : ""],
          ] as const
        ).map(([key, label, count, tone]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cx(
              "-mb-px mr-5 flex items-center gap-1.5 whitespace-nowrap border-b-2 py-2 text-[14px] font-semibold transition-colors",
              tab === key ? "border-brand-600 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-900",
            )}
          >
            {label}
            <span className={cx("rounded-sm px-1.5 text-[11px] font-semibold", tone === "red" ? "bg-red-600 text-white" : tone === "amber" ? "bg-stone-900 text-white" : "bg-stone-200 text-stone-700")}>{count}</span>
          </button>
        ))}
      </div>

      {tab === "attention" && (
        <Card title={`What to buy, ${attention.length} item${attention.length === 1 ? "" : "s"}, most urgent first`} flush>
          {attention.length === 0 ? (
            <p className="p-3 text-[13px] text-emerald-700">✓ Nothing to buy. Stock and purchases on the way cover the plan.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className={cx(tbl.table, "min-w-[980px]")}>
                <thead>
                  <tr>
                    <th className={tbl.th}>Buy</th>
                    <th className={tbl.th}>For</th>
                    <th className={tbl.th}>When</th>
                    <th className={tbl.th}>Place the order</th>
                    <th className={tbl.th} />
                  </tr>
                </thead>
                <tbody>
                  {[...attention]
                    .sort((x, y) => orderByDate(x).getTime() - orderByDate(y).getTime())
                    .map((a) => (
                      <AttentionRow key={a.id} a={a} months={months} canBuy={canBuy} />
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "stock" && (
        <StockGrid
          months={months}
          shown={shown}
          rows={rows}
          nav={
            <>
              <div className="flex items-center rounded-sm border border-stone-300 bg-white text-xs">
                <button type="button" disabled={start === 0} onClick={() => setStart(Math.max(0, start - WINDOW))} className="px-2 py-0.5 disabled:opacity-30">
                  ‹
                </button>
                <span className="border-x border-stone-300 px-2 py-0.5 font-medium">
                  {monthLabel(shown[0])} – {monthLabel(shown.at(-1)!)}
                </span>
                <button type="button" disabled={start + WINDOW >= months.length} onClick={() => setStart(Math.min(months.length - WINDOW, start + WINDOW))} className="px-2 py-0.5 disabled:opacity-30">
                  ›
                </button>
              </div>
              <ExportButton filename="sln-stock-coverage" rows={exportRows} />
            </>
          }
          onBuy={() => setTab("attention")}
        />
      )}

      {tab === "pos" && <PurchasesOnTheWay purchaseOrders={purchaseOrders} canBuy={canBuy} />}

      {tab === "beans" && (
        <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          <BeanPrices beanPrices={beanPrices} editable={canPrice} openGb={openGb} />
          <Card title={`Orders with bean price not fixed (${openGb.length})`} flush>
            <table className={tbl.table}>
              <thead>
                <tr>
                  <th className={tbl.th}>Order</th>
                  <th className={tbl.th}>Beans</th>
                  <th className={tbl.thR}>Needed</th>
                  <th className={tbl.th}>From</th>
                  <th className={tbl.thR}>+₹10/kg costs</th>
                  <th className={tbl.th}>Fix at ₹/kg</th>
                </tr>
              </thead>
              <tbody>
                {openGb.length === 0 && (
                  <tr>
                    <td colSpan={6} className={cx(tbl.td, "text-stone-500")}>
                      ✓ Every order has a fixed bean price.
                    </td>
                  </tr>
                )}
                {openGb.map((o) => (
                  <FixRow key={o.orderId} o={o} canFix={canBuy} />
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}

const num = (n: number, unit: string) => {
  const v = unit === "kg" ? n / 1000 : n;
  if (unit !== "kg" && Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}k`;
  return v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
};
const unitName = (unit: string) => (unit === "kg" ? "tonnes" : unit);

// Material × month ledger. Each cell = what is left at month end; click it to see who uses it and what arrives.
function StockGrid({ months, shown, rows, nav, onBuy }: { months: string[]; shown: string[]; rows: Row[]; nav: ReactNode; onBuy: () => void }) {
  const [sel, setSel] = useState<{ key: string; month: string } | null>(null);
  const row = sel ? rows.find((r) => r.key === sel.key) : null;
  const cell = row && sel ? row.cells[sel.month] : null;
  const grid = "border border-stone-200";
  const groups = [...new Set(rows.map((r) => r.group))];
  const [view, setView] = useState<"summary" | "months">("summary");
  const switcher = (
    <div className="inline-flex border border-stone-300 text-[13px]">
      {(
        [
          ["summary", "Summary"],
          ["months", "Month by month"],
        ] as const
      ).map(([k, label]) => (
        <button key={k} type="button" onClick={() => setView(k)} className={cx("border-r border-stone-300 px-3 py-1 font-semibold last:border-r-0", view === k ? "bg-stone-900 text-white" : "text-stone-600 hover:text-stone-900")}>
          {label}
        </button>
      ))}
    </div>
  );
  if (view === "summary")
    return (
      <div className="space-y-3">
        {switcher}
        <StockSummary
          rows={rows}
          months={months}
          groups={groups}
          onBuy={onBuy}
          onOpen={(key, month) => {
            setView("months");
            setSel({ key, month });
          }}
        />
      </div>
    );

  return (
    <div className="space-y-3">
      {switcher}
      <Card title="Month by month: needed, arriving, and left at month end" flush actions={nav}>
        <div className="overflow-x-auto">
          <table className="tabular w-full min-w-[1000px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-stone-100 text-[11px] font-semibold uppercase tracking-wide text-stone-600">
                <th className={cx(grid, "sticky left-0 z-10 min-w-56 bg-stone-100 px-2.5 py-1.5 text-left")}>Material</th>
                <th className={cx(grid, "px-2 py-1.5 text-left")}>Unit</th>
                <th className={cx(grid, "px-2 py-1.5 text-right")}>In stock</th>
                <th className={cx(grid, "px-2 py-1.5 text-right")}>On the way</th>
                {shown.map((m) => (
                  <th key={m} className={cx(grid, "px-2 py-1.5 text-right", months.indexOf(m) === 0 && "border-l-2 border-l-stone-400")}>
                    {monthLabel(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g}>
                  <tr className="bg-stone-50">
                    <td colSpan={4 + shown.length} className={cx(grid, "px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500")}>
                      {g}
                    </td>
                  </tr>
                  {rows
                    .filter((r) => r.group === g)
                    .map((r) => (
                      <tr key={r.key} className={cx(sel?.key === r.key && "bg-brand-50/40")}>
                        <td className={cx(grid, "sticky left-0 z-10 min-w-56 bg-white px-2.5 py-1 font-medium text-stone-900")}>{r.name.replace("Green beans · ", "")}</td>
                        <td className={cx(grid, "px-2 py-1 text-[12px] text-stone-500")}>{unitName(r.unit)}</td>
                        <td className={cx(grid, "px-2 py-1 text-right")}>{num(r.onHand, r.unit)}</td>
                        <td className={cx(grid, "px-2 py-1 text-right text-stone-600")}>{r.onOrder ? num(r.onOrder, r.unit) : "–"}</td>
                        {shown.map((m) => {
                          const c = r.cells[m];
                          const short = c.short > 0.5;
                          const active = c.need > 0 || c.arriving > 0;
                          const on = sel?.key === r.key && sel.month === m;
                          return (
                            <td
                              key={m}
                              onClick={() => {
                                setSel(on ? null : { key: r.key, month: m });
                                requestAnimationFrame(() => document.getElementById("stock-detail")?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
                              }}
                              className={cx(grid, "min-w-28 cursor-pointer px-2 py-1.5 align-top hover:bg-brand-50", short && "bg-red-50", on && "outline outline-2 -outline-offset-2 outline-brand-600")}
                            >
                              {!active ? (
                                <div className="text-right text-stone-300">–</div>
                              ) : (
                                <table className="w-full text-[11px] leading-4">
                                  <tbody>
                                    {c.need > 0 && (
                                      <tr>
                                        <td className="border-0 p-0 text-stone-500">Need</td>
                                        <td className="border-0 p-0 text-right text-stone-900">{num(c.need, r.unit)}</td>
                                      </tr>
                                    )}
                                    {c.arriving > 0 && (
                                      <tr>
                                        <td className="border-0 p-0 text-stone-500">In</td>
                                        <td className="border-0 p-0 text-right text-brand-600">+{num(c.arriving, r.unit)}</td>
                                      </tr>
                                    )}
                                    <tr>
                                      <td className={cx("border-0 p-0", short ? "font-semibold text-red-700" : "text-stone-500")}>{short ? "Short" : "Left"}</td>
                                      <td className={cx("border-0 p-0 text-right font-semibold", short ? "text-red-700" : "text-emerald-700")}>{short ? num(c.short, r.unit) : num(Math.max(0, c.balanceAfter), r.unit)}</td>
                                    </tr>
                                  </tbody>
                                </table>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-stone-200 px-3 py-1.5 text-[11px] text-stone-500">
          <b>Need</b> = used by production that month · <b>In</b> = purchase arriving · <b>Left</b> = stock at month end · <b className="text-red-700">Short</b> = missing, buy it · <b>Click a month</b> to see the orders behind it.
        </p>
      </Card>

      {row && cell && sel && (
        <div id="stock-detail">
          <Card
            title={`${row.name}, ${monthLabel(sel.month)}`}
            flush
            actions={
              <button type="button" onClick={() => setSel(null)} className="text-xs text-stone-500 hover:underline">
                Close ✕
              </button>
            }
          >
            <div className="grid gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
              <table className="tabular w-full border-collapse text-[13px] lg:border-r lg:border-stone-300">
                <tbody>
                  <Ledger label="At the start of the month" value={num(cell.available - cell.arriving, row.unit)} unit={row.unit} />
                  <Ledger label="+ Arriving this month" value={num(cell.arriving, row.unit)} unit={row.unit} tone={cell.arriving ? "blue" : undefined} />
                  <Ledger label="− Needed for production" value={num(cell.need, row.unit)} unit={row.unit} />
                  <Ledger
                    label={cell.short > 0.5 ? "= Short" : "= Left at month end"}
                    value={cell.short > 0.5 ? `−${num(cell.short, row.unit)}` : num(Math.max(0, cell.balanceAfter), row.unit)}
                    unit={row.unit}
                    tone={cell.short > 0.5 ? "red" : "green"}
                    strong
                  />
                </tbody>
              </table>
              <div>
                <table className={tbl.table}>
                  <thead>
                    <tr>
                      <th className={tbl.th}>Needed by</th>
                      <th className={tbl.th}>Line</th>
                      <th className={tbl.th}>Status</th>
                      <th className={tbl.thR}>Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cell.orders.length === 0 && (
                      <tr>
                        <td colSpan={4} className={cx(tbl.td, "text-stone-500")}>
                          No production uses this material in {monthLabel(sel.month)}.
                        </td>
                      </tr>
                    )}
                    {cell.orders.map((o) => (
                      <tr key={`${o.orderId}-${o.line}`} className={tbl.tr}>
                        <td className={tbl.td}>
                          <Link href={`/orders/${o.orderId}`} className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
                            {o.customer}
                          </Link>
                          <span className="ml-1.5 text-[11px] text-stone-500">{o.ref}</span>
                        </td>
                        <td className={tbl.td}>{o.line}</td>
                        <td className={tbl.td}>{o.status === "COMMITTED" ? "Approved" : "Waiting for approval"}</td>
                        <td className={tbl.tdR}>
                          {num(o.quantity, row.unit)} {unitName(row.unit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {cell.pos.length > 0 && (
                    <>
                      <thead>
                        <tr>
                          <th className={tbl.th} colSpan={3}>
                            Arriving from
                          </th>
                          <th className={tbl.thR}>Quantity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cell.pos.map((p) => (
                          <tr key={p.id} className={tbl.tr}>
                            <td className={tbl.td} colSpan={3}>
                              <span className="text-sky-700">▲</span> {p.supplier} · PO-{p.id}
                            </td>
                            <td className={tbl.tdR}>
                              {num(p.quantity, row.unit)} {unitName(row.unit)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </>
                  )}
                </table>
                {cell.short > 0.5 && (
                  <div className="flex items-center justify-between gap-2 border-t border-stone-300 bg-red-50 px-3 py-2 text-[13px] text-red-900">
                    <span>
                      {num(cell.short, row.unit)} {unitName(row.unit)} missing, procurement needs to buy it before {monthLabel(sel.month)}.
                    </span>
                    <button type="button" onClick={onBuy} className={buttonClass("primary", "sm")}>
                      Go to Needs attention
                    </button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// Stock at a glance: on hand, required by the plan, on order, and what is short (and by when to buy).
function StockSummary({ rows, months, onBuy, onOpen }: { rows: Row[]; months: string[]; groups: string[]; onBuy: () => void; onOpen: (key: string, month: string) => void }) {
  const [now] = useState(() => Date.now());
  const info = rows
    .map((r) => {
      const firstShort = months.find((m) => r.cells[m]?.short > 0.5);
      const required = months.reduce((a, m) => a + (r.cells[m]?.need ?? 0), 0);
      const orderBy = firstShort ? new Date(new Date(`${firstShort}-01T00:00:00`).getTime() - (r.leadDays ?? 0) * 86400000) : null;
      return { r, firstShort, required, short: firstShort ? r.cells[firstShort].short : 0, orderBy, late: orderBy ? orderBy.getTime() < now : false };
    })
    .sort((a, b) => Number(!a.firstShort) - Number(!b.firstShort) || (a.firstShort ?? "").localeCompare(b.firstShort ?? ""));
  const date = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const shortCount = info.filter((x) => x.firstShort).length;

  return (
    <div className="space-y-2">
      <p className="text-[13px] text-stone-600">
        <b className={shortCount ? "text-red-700" : "text-emerald-700"}>{shortCount ? `${shortCount} materials to buy` : "Nothing to buy"}</b>. Required is what approved and waiting orders need over the next {months.length} months. Order by = the
        month it runs out, minus the supplier lead time.
      </p>
      <div className={tbl.wrap}>
        <table className={cx(tbl.table, "min-w-[980px]")}>
          <thead>
            <tr>
              <th className={tbl.th}>Material</th>
              <th className={tbl.thR}>Stock on hand</th>
              <th className={tbl.thR}>Required</th>
              <th className={tbl.thR}>On order</th>
              <th className={tbl.thR}>Short</th>
              <th className={tbl.th}>Runs out</th>
              <th className={tbl.thR}>Lead time</th>
              <th className={tbl.th}>Order by</th>
              <th className={tbl.th} />
            </tr>
          </thead>
          <tbody>
            {info.map(({ r, firstShort, required, short, orderBy, late }) => {
              const u = (n: number) => (
                <>
                  {num(n, r.unit)} <span className="text-[11px] text-stone-400">{unitName(r.unit)}</span>
                </>
              );
              return (
                <tr key={r.key} className={cx(tbl.tr, firstShort && "bg-red-50/40")}>
                  <td className={cx(tbl.td, "font-medium text-stone-900")}>{r.name.replace("Green beans · ", "Beans · ")}</td>
                  <td className={tbl.tdR}>{u(r.onHand)}</td>
                  <td className={tbl.tdR}>{required ? u(required) : "–"}</td>
                  <td className={cx(tbl.tdR, "text-stone-600")}>{r.onOrder ? u(r.onOrder) : "–"}</td>
                  <td className={cx(tbl.tdR, firstShort ? "font-semibold text-red-700" : "text-emerald-700")}>{firstShort ? u(short) : "None"}</td>
                  <td className={cx(tbl.td, "whitespace-nowrap")}>{firstShort ? monthLabel(firstShort) : "–"}</td>
                  <td className={cx(tbl.tdR, "whitespace-nowrap text-stone-600")}>{r.leadDays ? `${r.leadDays} days` : "–"}</td>
                  <td className={cx(tbl.td, "whitespace-nowrap", late && "font-semibold text-red-700")}>{orderBy ? (late ? "Now, already late" : date(orderBy)) : "–"}</td>
                  <td className={cx(tbl.td, "whitespace-nowrap text-right")}>
                    <button type="button" onClick={() => onOpen(r.key, firstShort ?? months[0])} className="text-[12px] text-stone-500 underline underline-offset-2 hover:text-stone-900">
                      By month
                    </button>
                    {firstShort && (
                      <button type="button" onClick={onBuy} className={cx(buttonClass("primary", "sm"), "ml-2")}>
                        Buy
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Ledger({ label, value, unit, tone, strong }: { label: string; value: string; unit: string; tone?: "red" | "green" | "blue"; strong?: boolean }) {
  return (
    <tr className={cx("border-b border-stone-200 last:border-0", strong && "font-semibold", tone === "red" && "bg-red-50", tone === "green" && strong && "bg-emerald-50")}>
      <td className="px-3 py-1.5 text-stone-700">{label}</td>
      <td className={cx("whitespace-nowrap px-3 py-1.5 text-right", tone === "red" ? "text-red-700" : tone === "blue" ? "text-sky-700" : tone === "green" ? "text-emerald-700" : "text-stone-900")}>
        {value} <span className="text-[11px] font-normal text-stone-500">{unitName(unit)}</span>
      </td>
    </tr>
  );
}

// Last day to place the order: first day of the month it is needed, minus the supplier lead time.
function orderByDate(a: Attention) {
  return new Date(new Date(`${a.month}-01T00:00:00`).getTime() - a.leadDays * 86400000);
}

function AttentionRow({ a, months, canBuy }: { a: Attention; months: string[]; canBuy: boolean }) {
  const factor = a.unit === "kg" ? 1000 : 1;
  const [qty, setQty] = useState(String(Math.ceil((a.quantity / factor) * 10) / 10));
  const arrivalOptions = months.filter((m) => m >= a.earliestArrival);
  const [arrival, setArrival] = useState(arrivalOptions[0] ?? a.earliestArrival);
  const [supplier, setSupplier] = useState(a.supplier);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const late = a.earliestArrival > a.month;
  const by = orderByDate(a).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  return (
    <tr className={cx(tbl.tr, "align-top", late && "bg-red-50/60")}>
      <td className={tbl.td}>
        <div className="text-[14px] font-semibold text-red-700">{fmt(a.quantity, a.unit)}</div>
        <div className="font-medium text-stone-900">{a.name.replace("Green beans · ", "Beans · ")}</div>
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-stone-500">{a.requestId ? "Planner request" : "Found in the plan"}</div>
      </td>
      <td className={cx(tbl.td, "max-w-56 text-[13px]")}>
        {a.orders.length ? (
          a.orders.map((o, i) => (
            <span key={o.orderId}>
              {i > 0 && ", "}
              <Link href={`/orders/${o.orderId}`} className="text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
                {o.customer}
              </Link>
            </span>
          ))
        ) : (
          <span className="text-stone-600">{a.source}</span>
        )}
      </td>
      <td className={cx(tbl.td, "whitespace-nowrap text-[13px]")}>
        <div>
          Needed <b>{monthLabel(a.month)}</b>
        </div>
        {late ? (
          <div className="mt-0.5 font-semibold text-red-700">
            Too late: earliest arrival {monthLabel(a.earliestArrival)}
            <div className="font-normal">Move production later or buy locally</div>
          </div>
        ) : (
          <div className="mt-0.5">
            Order by <b>{by}</b>
          </div>
        )}
        <div className="text-[11px] text-stone-500">{a.leadDays} days lead time</div>
      </td>
      <td className={tbl.td}>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-[12px]">
          <span className="text-stone-500">Quantity</span>
          <span className="flex items-center gap-1">
            <input type="number" min="0" value={qty} disabled={!canBuy} onChange={(e) => setQty(e.target.value)} className={cx(tbl.input, "w-24 text-right")} aria-label="Quantity" />
            <span className="text-stone-500">{a.unit === "kg" ? "t" : a.unit}</span>
          </span>
          <span className="text-stone-500">Arrives</span>
          <select value={arrival} disabled={!canBuy} onChange={(e) => setArrival(e.target.value)} className={cx(tbl.input, "w-28")} aria-label="Arrival month">
            {arrivalOptions.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <span className="text-stone-500">Supplier</span>
          <input value={supplier} disabled={!canBuy} onChange={(e) => setSupplier(e.target.value)} className={cx(tbl.input, "w-48")} aria-label="Supplier" />
        </div>
      </td>
      <td className={cx(tbl.td, "whitespace-nowrap text-right")}>
        {canBuy ? (
          <div className="flex flex-col items-end gap-1">
            <button type="button" disabled={pending} onClick={() => start(async () => setMsg((await purchaseOrderAction(a.key, Number(qty) * factor, arrival, supplier, a.requestId)).error ?? "Ordered ✓"))} className={buttonClass("primary")}>
              Place order
            </button>
            {a.requestId && (
              <button type="button" disabled={pending} onClick={() => start(async () => setMsg((await dismissRequestAction(a.requestId!)).error ?? "Closed"))} className="text-[11px] text-stone-500 underline underline-offset-2 hover:text-stone-900">
                Not needed, close
              </button>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-stone-400">Procurement places it</span>
        )}
        {msg && <div className="mt-1 text-[11px] text-stone-600">{msg}</div>}
      </td>
    </tr>
  );
}

// Purchases grouped by the month they arrive; each says whether it is due, overdue or on time.
function PurchasesOnTheWay({ purchaseOrders, canBuy }: { purchaseOrders: PO[]; canBuy: boolean }) {
  const now = currentMonth();
  const months = [...new Set(purchaseOrders.map((p) => p.arrivalMonth))].sort();
  const overdue = purchaseOrders.filter((p) => p.arrivalMonth < now).length;
  const due = purchaseOrders.filter((p) => p.arrivalMonth === now).length;
  // Accordion: the first month and anything overdue or due start open.
  const [open, setOpen] = useState<Set<string>>(() => new Set(months.filter((m, i) => i === 0 || m <= now)));
  const toggle = (m: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(m)) n.delete(m);
      else n.add(m);
      return n;
    });

  if (!purchaseOrders.length) return <p className="border border-stone-300 bg-stone-50 p-4 text-[13px] text-stone-500">No purchases on the way.</p>;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-stone-600">
        <b>{purchaseOrders.length} purchases</b> on the way
        {overdue > 0 && (
          <>
            {" "}
            · <b className="text-red-700">{overdue} overdue</b>
          </>
        )}
        {due > 0 && <> · {due} due this month</>}. Press <b>Received</b> when the goods arrive; the stock updates.
        <button type="button" onClick={() => setOpen(new Set(months))} className="ml-3 text-[12px] text-stone-500 underline underline-offset-2 hover:text-stone-900">
          Open all
        </button>
        <button type="button" onClick={() => setOpen(new Set())} className="ml-2 text-[12px] text-stone-500 underline underline-offset-2 hover:text-stone-900">
          Close all
        </button>
      </p>
      <div className={tbl.wrap}>
        <table className={cx(tbl.table, "min-w-[820px]")}>
          <thead>
            <tr>
              <th className={tbl.th}>Material</th>
              <th className={tbl.thR}>Quantity</th>
              <th className={tbl.th}>Supplier</th>
              <th className={tbl.th}>Status</th>
              <th className={tbl.th}>PO</th>
              <th className={tbl.th} />
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const list = purchaseOrders.filter((p) => p.arrivalMonth === m);
              return (
                <Fragment key={m}>
                  <tr className="cursor-pointer bg-stone-50 hover:bg-stone-100" onClick={() => toggle(m)}>
                    <td colSpan={6} className="px-2.5 py-2 text-[13px] font-semibold text-stone-900">
                      <span className="mr-2 inline-block w-3 font-mono text-stone-500">{open.has(m) ? "−" : "+"}</span>
                      Arriving {monthLabel(m)}{" "}
                      <span className="font-normal text-stone-500">
                        · {list.length} purchase{list.length === 1 ? "" : "s"}
                        {!open.has(m) &&
                          `: ${list
                            .map((p) => (p.name.startsWith("Green beans · ") ? `Beans (${p.name.split(" · ")[1]})` : p.name))
                            .filter((x, i, a) => a.indexOf(x) === i)
                            .join(", ")}`}
                      </span>
                      {m < now && <span className="ml-2 text-[12px] font-semibold text-red-700">Overdue</span>}
                    </td>
                  </tr>
                  {open.has(m) && list.map((p) => <PoRow key={p.id} po={p} canBuy={canBuy} status={p.arrivalMonth < now ? "overdue" : p.arrivalMonth === now ? "due" : "ontime"} />)}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PoRow({ po, canBuy, status }: { po: PO; canBuy: boolean; status: "overdue" | "due" | "ontime" }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <tr className={cx(tbl.tr, status === "overdue" && "bg-red-50/50")}>
      <td className={cx(tbl.td, "font-medium text-stone-900")}>{po.name.replace("Green beans · ", "Beans · ")}</td>
      <td className={cx(tbl.tdR, "font-semibold")}>
        {num(po.quantity, po.unit)} <span className="text-[11px] font-normal text-stone-400">{unitName(po.unit)}</span>
      </td>
      <td className={cx(tbl.td, "text-stone-600")}>{po.supplier}</td>
      <td className={cx(tbl.td, "whitespace-nowrap", status === "overdue" ? "font-semibold text-red-700" : status === "due" ? "font-semibold text-stone-900" : "text-emerald-700")}>
        {status === "overdue" ? "Overdue, chase supplier" : status === "due" ? "Due this month" : "On time"}
      </td>
      <td className={cx(tbl.td, "font-mono text-[11px] text-stone-500")}>PO-{po.id}</td>
      <td className={cx(tbl.td, "whitespace-nowrap text-right")}>
        {canBuy && (
          <button type="button" disabled={pending} onClick={() => start(async () => setMsg((await receiveAction(po.id)).error))} className={buttonClass("secondary", "sm")}>
            Received
          </button>
        )}
        {msg && <span className="ml-1 text-[11px] text-red-700">{msg}</span>}
      </td>
    </tr>
  );
}

function BeanPrices({ beanPrices, editable, openGb }: { beanPrices: { key: string; value: number }[]; editable: boolean; openGb: { origin: string }[] }) {
  const [state, action, pending] = useActionState(saveBeanPrices, {});
  return (
    <form action={action}>
      <Card
        title="Market price"
        flush
        actions={
          editable && (
            <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
              Save
            </button>
          )
        }
      >
        <table className={tbl.table}>
          <thead>
            <tr>
              <th className={tbl.th}>Origin</th>
              <th className={tbl.thR}>₹/kg</th>
              <th className={tbl.thR}>Open orders</th>
            </tr>
          </thead>
          <tbody>
            {beanPrices.map((b) => {
              const name = ORIGINS[b.key.split(".")[1] as Origin];
              return (
                <tr key={b.key}>
                  <td className={tbl.td}>{name}</td>
                  <td className={tbl.tdR}>
                    <input name={b.key} type="number" min="0" defaultValue={b.value} disabled={!editable} className={cx(tbl.input, "w-20 text-right")} aria-label={`${name} price`} />
                  </td>
                  <td className={cx(tbl.tdR, "text-stone-600")}>{openGb.filter((o) => o.origin === name).length || "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {state.message && <p className="border-t border-stone-200 px-3 py-1.5 text-[12px] text-stone-600">{state.message}</p>}
      </Card>
    </form>
  );
}

function FixRow({ o, canFix }: { o: { orderId: number; ref: string; customer: string; origin: string; grade: string; market: number; beanT: number; firstMonth: string; approved: boolean }; canFix: boolean }) {
  const [price, setPrice] = useState(o.market);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <tr className={tbl.tr}>
      <td className={tbl.td}>
        <Link href={`/orders/${o.orderId}`} className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
          {o.customer}
        </Link>
      </td>
      <td className={cx(tbl.td, "text-stone-600")}>
        {o.origin} · {o.grade}
      </td>
      <td className={tbl.tdR}>{o.beanT.toLocaleString("en-IN", { maximumFractionDigits: 0 })} t</td>
      <td className={cx(tbl.td, "whitespace-nowrap")}>{o.firstMonth ? monthLabel(o.firstMonth) : "–"}</td>
      <td className={cx(tbl.tdR, "text-stone-600")}>₹{((o.beanT * 1000 * 10) / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} L</td>
      <td className={cx(tbl.td, "whitespace-nowrap")}>
        {msg ? (
          <span className="text-[12px] text-stone-700">{msg}</span>
        ) : canFix ? (
          <span className="flex items-center gap-1.5">
            <input type="number" min="1" value={price} onChange={(e) => setPrice(Number(e.target.value))} className={cx(tbl.input, "w-20 text-right")} aria-label="Fixed price" />
            <button
              type="button"
              disabled={pending || !(price > 0)}
              title={o.approved ? "Approved order, goes back to CFO and COO" : undefined}
              onClick={() =>
                start(async () => {
                  const r = await gbClosureAction(o.orderId, true, price);
                  setMsg(r.error ?? `✓ Fixed at ₹${price}`);
                })
              }
              className={buttonClass("primary", "sm")}
            >
              Fix
            </button>
            {o.approved && <span className="text-[11px] text-amber-700">re-approval</span>}
          </span>
        ) : (
          <span className="text-stone-500">Market ₹{o.market}</span>
        )}
      </td>
    </tr>
  );
}
