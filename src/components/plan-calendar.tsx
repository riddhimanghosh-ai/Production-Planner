"use client";

import Link from "next/link";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { applyPlanMove, carryOverAction, monthCapacityAction, recordProductionAction, releaseReservationAction, requestMaterialAction, reserveAction, simulatePlanMove } from "@/app/actions";
import { addMonths, currentMonth, monthLabel, PRODUCT_TYPES, type ProductType } from "@/lib/domain";
import { cx } from "./ui";

export type CalendarOrder = {
  allocationId: number;
  orderId: number;
  ref: string;
  customer: string;
  quantityMt: number;
  status: string;
  productType: string;
  product: string;
  producedMt: number | null;
};
export type CalendarCell = {
  capacity: number;
  used: number;
  reserved: number;
  note: string;
  orders: CalendarOrder[];
  reservations: {
    id: number;
    label: string;
    quantityMt: number;
    productType: string;
  }[];
  materials: {
    key: string;
    name: string;
    unit: string;
    need: number;
    monthShort: number;
  }[];
};
type LineView = {
  id: number;
  code: string;
  name: string;
  capacityMt: number;
  productTypes: string[];
};
type Sim = Awaited<ReturnType<typeof simulatePlanMove>>;

const WINDOW = 6;
const t = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} t`;
const qty = (n: number, unit: string) => (unit === "kg" ? t(n / 1000) : `${Math.round(n).toLocaleString("en-IN")} ${unit}`);

// One colour per product, used everywhere on the calendar.
export const PRODUCT_COLOR: Record<string, { bar: string; chip: string; dot: string }> = {
  SD: {
    bar: "border-amber-700",
    chip: "bg-amber-100 text-amber-900 border-amber-300",
    dot: "bg-amber-700",
  },
  AG: {
    bar: "border-sky-600",
    chip: "bg-sky-100 text-sky-900 border-sky-300",
    dot: "bg-sky-600",
  },
  FDC: {
    bar: "border-violet-600",
    chip: "bg-violet-100 text-violet-900 border-violet-300",
    dot: "bg-violet-600",
  },
};
const ALL_PRODUCTS = Object.keys(PRODUCT_TYPES) as ProductType[];

export function ProductChip({ p, children }: { p: string; children?: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1 text-[10px] font-semibold leading-4", PRODUCT_COLOR[p]?.chip)}>{children ?? PRODUCT_TYPES[p as ProductType]}</span>;
}

function mixOf(c: CalendarCell) {
  const m = new Map<string, number>();
  for (const o of c.orders) m.set(o.productType, (m.get(o.productType) ?? 0) + o.quantityMt);
  for (const r of c.reservations) m.set(r.productType, (m.get(r.productType) ?? 0) + r.quantityMt);
  return ALL_PRODUCTS.filter((p) => m.get(p)).map((p) => ({
    p,
    qty: m.get(p)!,
  }));
}

function tone(used: number, cap: number) {
  if (used > cap + 0.05)
    return {
      box: "border-red-300 bg-red-50/60",
      bar: "bg-red-500",
      text: "text-red-700",
    };
  if (cap > 0 && used / cap >= 0.9)
    return {
      box: "border-amber-300 bg-amber-50/50",
      bar: "bg-amber-500",
      text: "text-amber-800",
    };
  return {
    box: "border-stone-200 bg-white",
    bar: "bg-emerald-500",
    text: "text-emerald-700",
  };
}

export function PlanCalendar({ months, lines, cells, canEdit, canRequest }: { months: string[]; lines: LineView[]; cells: Record<string, CalendarCell>; canEdit: boolean; canRequest: boolean }) {
  const [start, setStart] = useState(0);
  const [open, setOpen] = useState<{ lineId: number; month: string } | null>(null);
  const [move, setMove] = useState<{
    order: CalendarOrder;
    fromLine: number;
    fromMonth: string;
    lineId: number;
    month: string;
  } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const shown = months.slice(start, start + WINDOW);
  const cell = (lineId: number, m: string) => cells[`${lineId}|${m}`];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-sm border border-stone-300 bg-white">
          <button type="button" disabled={start === 0} onClick={() => setStart(Math.max(0, start - WINDOW))} className="px-2 py-1 text-xs font-medium hover:bg-stone-100 disabled:opacity-30">
            ‹ Earlier
          </button>
          <span className="border-x border-stone-300 px-2 py-1 text-xs font-semibold text-stone-900">
            {monthLabel(shown[0])} – {monthLabel(shown.at(-1)!)}
          </span>
          <button type="button" disabled={start + WINDOW >= months.length} onClick={() => setStart(Math.min(months.length - WINDOW, start + WINDOW))} className="px-2 py-1 text-xs font-medium hover:bg-stone-100 disabled:opacity-30">
            Later ›
          </button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-stone-600">
          {ALL_PRODUCTS.map((p) => (
            <span key={p} className="flex items-center gap-1.5">
              <span className={cx("h-3 w-1", PRODUCT_COLOR[p].dot)} /> {PRODUCT_TYPES[p]}
            </span>
          ))}
        </div>
      </div>

      {canEdit && <p className="text-xs text-stone-500">Click a box to see its orders, move them, change capacity or reserve time.</p>}

      <div className="overflow-x-auto rounded-md border border-stone-300 bg-white">
        <table className="tabular w-full min-w-[1000px] table-fixed border-collapse text-[12px]">
          <colgroup>
            <col className="w-36" />
            {shown.map((m) => (
              <col key={m} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="border-b border-r border-stone-300 bg-stone-100 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-600">Line</th>
              {shown.map((m) => (
                <th key={m} className="border-b border-r border-stone-300 bg-stone-100 px-2 py-2 text-left last:border-r-0">
                  <div className="text-[13px] font-semibold text-stone-900">{monthLabel(m)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="align-top">
                <th className="border-b border-r border-stone-300 bg-stone-50 px-2 py-2 text-left font-normal">
                  <div className="text-[13px] font-semibold text-stone-900">{l.code}</div>
                  <div className="text-[11px] text-stone-500">
                    Capacity <span className="text-stone-900">{l.capacityMt} t / month</span>
                  </div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">Can make</div>
                  <div className="mt-0.5 flex flex-wrap gap-0.5">
                    {l.productTypes.map((p) => (
                      <ProductChip key={p} p={p} />
                    ))}
                  </div>
                </th>
                {shown.map((m) => {
                  const c = cell(l.id, m);
                  if (!c) return <td key={m} className="border-b border-r border-stone-300" />;
                  const tn = tone(c.used, c.capacity);
                  const free = c.capacity - c.used;
                  const matShort = c.materials.filter((x) => x.monthShort > 0.5);
                  const k = `${l.id}|${m}`;
                  return (
                    <td
                      key={m}
                      onClick={() => setOpen({ lineId: l.id, month: m })}
                      onDragOver={(e) => {
                        if (!canEdit) return;
                        e.preventDefault();
                        setDragOver(k);
                      }}
                      onDragLeave={() => setDragOver((d) => (d === k ? null : d))}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(null);
                        const data = e.dataTransfer.getData("text/plain");
                        if (!data) return;
                        const { order, fromLine, fromMonth } = JSON.parse(data) as {
                          order: CalendarOrder;
                          fromLine: number;
                          fromMonth: string;
                        };
                        if (fromLine === l.id && fromMonth === m) return;
                        setMove({
                          order,
                          fromLine,
                          fromMonth,
                          lineId: l.id,
                          month: m,
                        });
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && setOpen({ lineId: l.id, month: m })}
                      className={cx(
                        "h-20 cursor-pointer border-b border-r border-stone-300 p-1.5 last:border-r-0 hover:bg-brand-50/60",
                        free < -0.05 ? "bg-red-50" : c.capacity > 0 && c.used / c.capacity >= 0.9 ? "bg-amber-50/60" : "",
                        dragOver === k && "outline outline-2 -outline-offset-2 outline-brand-500",
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="font-semibold text-stone-900">
                          {t(c.used)}
                          <span className="font-normal text-stone-500"> / {c.capacity}</span>
                        </span>
                        <span className={cx("text-[11px] font-semibold", tn.text)}>{free < -0.05 ? `+${t(-free)} over` : free < 0.05 ? "full" : `${t(free)} free`}</span>
                      </div>
                      <div className="mt-0.5 h-1 bg-stone-200">
                        <div
                          className={cx("h-full", tn.bar)}
                          style={{
                            width: `${c.capacity ? Math.min(100, (c.used / c.capacity) * 100) : 100}%`,
                          }}
                        />
                      </div>
                      {mixOf(c).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-0.5">
                          {mixOf(c).map((x) => (
                            <ProductChip key={x.p} p={x.p}>
                              {PRODUCT_TYPES[x.p as ProductType]} {t(x.qty)}
                            </ProductChip>
                          ))}
                        </div>
                      )}
                      {(c.note || c.materials.length > 0) && (
                        <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-semibold">
                          {c.note && <span className="text-sky-800">{c.note}</span>}
                          {c.materials.length > 0 && <span className={matShort.length ? "text-amber-800" : "text-emerald-700"}>{matShort.length ? `${matShort.length} material short` : "✓ materials"}</span>}
                        </div>
                      )}
                      <div className="mt-1 text-[11px] text-stone-500">
                        {c.orders.length || c.reservations.length ? [c.orders.length && `${c.orders.length} order${c.orders.length > 1 ? "s" : ""}`, c.reservations.length && `${c.reservations.length} reserved`].filter(Boolean).join(" · ") : "empty"}
                      </div>
                      {(() => {
                        const approvedT = c.orders.filter((o) => o.status === "COMMITTED").reduce((x, o) => x + o.quantityMt, 0);
                        if (approvedT <= 0) return null;
                        const madeT = c.orders.reduce((x, o) => x + (o.producedMt ?? 0), 0);
                        const anyRecorded = c.orders.some((o) => o.producedMt != null);
                        return (
                          // Red only once the month is over and still short; while it runs, it is just progress.
                          <div className={cx("mt-0.5 text-[11px]", !anyRecorded ? "text-stone-400" : madeT >= approvedT - 0.05 ? "font-medium text-emerald-700" : m < currentMonth() ? "font-medium text-red-700" : "font-medium text-stone-700")}>
                            Made {t(madeT)} of {t(approvedT)}
                            {anyRecorded && madeT < approvedT - 0.05 && m >= currentMonth() && <span className="font-normal text-stone-500"> · in progress</span>}
                          </div>
                        );
                      })()}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <CellDrawer
          key={`${open.lineId}-${open.month}`}
          line={lines.find((l) => l.id === open.lineId)!}
          month={open.month}
          cell={cell(open.lineId, open.month)}
          lines={lines}
          months={months}
          canEdit={canEdit}
          canRequest={canRequest}
          onClose={() => setOpen(null)}
          onMove={(o, lineId, month) =>
            setMove({
              order: o,
              fromLine: open.lineId,
              fromMonth: open.month,
              lineId,
              month,
            })
          }
        />
      )}
      {move && <MoveDialog key={`${move.order.allocationId}-${move.lineId}-${move.month}`} move={move} lines={lines} canApply={canEdit} onClose={() => setMove(null)} />}
    </div>
  );
}

function CellDrawer({
  line,
  month,
  cell,
  lines,
  months,
  canEdit,
  canRequest,
  onClose,
  onMove,
}: {
  line: LineView;
  month: string;
  cell: CalendarCell;
  lines: LineView[];
  months: string[];
  canEdit: boolean;
  canRequest: boolean;
  onClose: () => void;
  onMove: (o: CalendarOrder, lineId: number, month: string) => void;
}) {
  const [cap, setCap] = useState(String(cell.capacity));
  const [note, setNote] = useState(cell.note);
  const [res, setRes] = useState({
    qty: "",
    label: "",
    productType: line.productTypes[0],
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const free = cell.capacity - cell.used;
  const act = (fn: () => Promise<{ error: string | null }>, ok: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ?? ok);
    });

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-y-auto border-l border-stone-300 bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{line.code}</div>
            <h2 className="text-2xl font-semibold text-stone-900">{monthLabel(month)}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-stone-600">
              Can make:
              {line.productTypes.map((p) => (
                <ProductChip key={p} p={p} />
              ))}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-sm px-2 py-1 text-stone-500 hover:bg-stone-100" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-stone-50 p-3">
            <div className="text-xs text-stone-500">Max</div>
            <div className="text-lg font-semibold">{t(cell.capacity)}</div>
          </div>
          <div className="rounded-md bg-stone-50 p-3">
            <div className="text-xs text-stone-500">Planned</div>
            <div className="text-lg font-semibold">{t(cell.used)}</div>
          </div>
          <div className={cx("rounded-md p-3", free < -0.05 ? "bg-red-50" : "bg-emerald-50")}>
            <div className="text-xs text-stone-500">{free < -0.05 ? "Over" : "Free"}</div>
            <div className={cx("text-lg font-semibold", free < -0.05 ? "text-red-700" : "text-emerald-700")}>{t(Math.abs(free))}</div>
          </div>
        </div>

        {msg && <p className="mt-4 rounded-sm bg-stone-100 px-3 py-2 text-sm text-stone-700">{msg}</p>}

        <Section title="Orders in this box">
          {cell.orders.length === 0 && <p className="text-sm text-stone-500">No orders yet.</p>}
          <ul className="space-y-2">
            {cell.orders.map((o) => (
              <li key={o.allocationId} className="rounded-md border border-stone-200 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/orders/${o.orderId}`} className="font-semibold text-stone-900 hover:underline">
                    {o.customer}
                  </Link>
                  <span className="font-semibold">{t(o.quantityMt)}</span>
                </div>
                <div className="flex items-center gap-1 text-xs text-stone-500">
                  <ProductChip p={o.productType} />
                  {o.product} · {o.status === "COMMITTED" ? "approved" : "waiting for approval"}
                </div>
                {o.status === "COMMITTED" && <MadeRecorder order={o} month={month} canEdit={canEdit} />}
                {canEdit && <MovePicker order={o} line={line} month={month} lines={lines} months={months} onPick={(lineId, m) => onMove(o, lineId, m)} />}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Materials for this box">
          {cell.materials.length === 0 ? (
            <p className="text-sm text-stone-500">Nothing needed yet.</p>
          ) : (
            <ul className="space-y-2">
              {cell.materials.map((m) => (
                <li key={m.key} className={cx("rounded-md p-3 text-sm", m.monthShort > 0.5 ? "bg-amber-50" : "bg-emerald-50")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-stone-900">{m.name}</span>
                    <span className={m.monthShort > 0.5 ? "font-semibold text-amber-800" : "text-emerald-700"}>{m.monthShort > 0.5 ? "Short" : "✓ In stock / on the way"}</span>
                  </div>
                  <div className="text-xs text-stone-600">
                    Needs {qty(m.need, m.unit)}
                    {m.monthShort > 0.5 && ` · ${qty(m.monthShort, m.unit)} missing across ${monthLabel(month)}`}
                  </div>
                  {m.monthShort > 0.5 && canRequest && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => act(() => requestMaterialAction(m.key, Math.ceil(m.monthShort), month, `For ${line.code}, ${monthLabel(month)}`), "Sent to procurement ✓")}
                      className="mt-2 border border-stone-900 bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white hover:border-brand-600 hover:bg-brand-600"
                    >
                      Ask procurement to buy {qty(m.monthShort, m.unit)}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Link href="/procurement" className="mt-2 block text-xs font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
            See all stock →
          </Link>
        </Section>

        {canEdit && (
          <>
            <Section title="Capacity this month">
              <div className="flex gap-2">
                <input type="number" min="0" value={cap} onChange={(e) => setCap(e.target.value)} className="w-24 rounded-sm border border-stone-300 px-3 py-2 text-right text-sm" aria-label="Capacity tonnes" />
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (e.g. maintenance)" className="flex-1 rounded-sm border border-stone-300 px-3 py-2 text-sm" />
              </div>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={pending} onClick={() => act(() => monthCapacityAction(line.id, month, Number(cap), note), "Capacity saved ✓")} className="rounded-sm bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white">
                  Save
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setCap("0");
                    setNote("Line stopped");
                    act(() => monthCapacityAction(line.id, month, 0, "Line stopped"), "Line blocked for the month ✓");
                  }}
                  className="rounded-sm border border-stone-300 px-3 py-1.5 text-sm"
                >
                  Block whole month
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setCap(String(line.capacityMt));
                    setNote("");
                    act(() => monthCapacityAction(line.id, month, line.capacityMt, ""), "Back to normal ✓");
                  }}
                  className="rounded-sm px-2 py-1.5 text-sm text-stone-500 hover:underline"
                >
                  Reset to {line.capacityMt} t
                </button>
              </div>
            </Section>

            <Section title="Reserve time (no order yet)">
              {cell.reservations.map((r) => (
                <div key={r.id} className="mb-2 flex items-center justify-between rounded-sm bg-stone-100 px-3 py-2 text-sm">
                  <span>
                    {r.label} · {t(r.quantityMt)}
                  </span>
                  <button type="button" disabled={pending} onClick={() => act(() => releaseReservationAction(r.id), "Released ✓")} className="text-xs font-medium text-red-700 hover:underline">
                    Release
                  </button>
                </div>
              ))}
              <div className="grid grid-cols-[80px_1fr] gap-2">
                <input type="number" min="0" value={res.qty} onChange={(e) => setRes({ ...res, qty: e.target.value })} placeholder="Tonnes" className="rounded-sm border border-stone-300 px-3 py-2 text-sm" />
                <input value={res.label} onChange={(e) => setRes({ ...res, label: e.target.value })} placeholder="For whom / why" className="rounded-sm border border-stone-300 px-3 py-2 text-sm" />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <select value={res.productType} onChange={(e) => setRes({ ...res, productType: e.target.value })} className="rounded-sm border border-stone-300 px-2 py-1.5 text-sm">
                  {line.productTypes.map((p) => (
                    <option key={p} value={p}>
                      {PRODUCT_TYPES[p as ProductType]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => act(() => reserveAction(line.id, month, Number(res.qty), res.label, res.productType), "Time reserved ✓")}
                  className="rounded-sm bg-stone-800 px-3 py-1.5 text-sm font-semibold text-white"
                >
                  Reserve
                </button>
              </div>
            </Section>
          </>
        )}
        {!canEdit && <p className="mt-6 text-xs text-stone-500">Only the COO or production planner can change the calendar.</p>}
      </aside>
    </div>
  );
}

// Record what was actually made for this slot, right from the calendar.
function MadeRecorder({ order, month, canEdit }: { order: CalendarOrder; month: string; canEdit: boolean }) {
  const [made, setMade] = useState(order.producedMt == null ? "" : String(order.producedMt));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const done = order.producedMt != null && order.producedMt >= order.quantityMt - 0.05;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-stone-200 pt-2 text-xs">
      <span className="text-stone-500">Made</span>
      <input type="number" min="0" step="0.1" value={made} disabled={!canEdit} onChange={(e) => setMade(e.target.value)} placeholder="0" className="w-16 border border-stone-300 px-1 py-0.5 text-right" aria-label="Tonnes made" />
      <span className="text-stone-500">of {t(order.quantityMt)}</span>
      {canEdit && (
        <>
          <button type="button" onClick={() => setMade(String(order.quantityMt))} className="text-stone-500 underline underline-offset-2 hover:text-stone-900">
            All
          </button>
          <button
            type="button"
            disabled={pending || made === ""}
            onClick={() =>
              start(async () => {
                const r = await recordProductionAction(order.allocationId, Number(made), "");
                setMsg(r.error ?? "Recorded");
              })
            }
            className="border border-stone-900 bg-stone-900 px-2 py-0.5 font-medium text-white hover:border-brand-600 hover:bg-brand-600 disabled:opacity-40"
          >
            Record
          </button>
        </>
      )}
      <span className={cx("font-medium", order.producedMt == null ? "text-stone-400" : done ? "text-emerald-700" : "text-red-700")}>
        {msg ?? (order.producedMt == null ? "Not recorded" : done ? "Done" : `Short ${t(order.quantityMt - order.producedMt)}`)}
      </span>
      {canEdit && order.producedMt != null && !done && (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setMsg((await carryOverAction(order.allocationId)).error ?? "Moved"))}
          className="border border-stone-900 px-1.5 py-0.5 font-medium text-stone-900 hover:border-brand-600 hover:text-brand-600"
        >
          Move {t(order.quantityMt - order.producedMt)} to {monthLabel(addMonths(month, 1))}
        </button>
      )}
    </div>
  );
}

function MovePicker({ order, line, month, lines, months, onPick }: { order: CalendarOrder; line: LineView; month: string; lines: LineView[]; months: string[]; onPick: (lineId: number, month: string) => void }) {
  const options = lines.filter((l) => l.productTypes.includes(order.productType));
  const [to, setTo] = useState({ lineId: line.id, month });
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-stone-500">Move to</span>
      <select value={to.lineId} onChange={(e) => setTo({ ...to, lineId: Number(e.target.value) })} className="rounded-md border border-stone-300 px-1.5 py-1">
        {options.map((l) => (
          <option key={l.id} value={l.id}>
            {l.code}
          </option>
        ))}
      </select>
      <select value={to.month} onChange={(e) => setTo({ ...to, month: e.target.value })} className="rounded-md border border-stone-300 px-1.5 py-1">
        {months.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
      <button type="button" disabled={to.lineId === line.id && to.month === month} onClick={() => onPick(to.lineId, to.month)} className="rounded-md bg-brand-600 px-2 py-1 font-semibold text-white disabled:opacity-40">
        Check impact
      </button>
    </div>
  );
}

function MoveDialog({
  move,
  lines,
  canApply,
  onClose,
}: {
  move: {
    order: CalendarOrder;
    fromLine: number;
    fromMonth: string;
    lineId: number;
    month: string;
  };
  lines: LineView[];
  canApply: boolean;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(String(move.order.quantityMt));
  const [sim, setSim] = useState<Sim>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const req = {
    allocationId: move.order.allocationId,
    lineId: move.lineId,
    month: move.month,
    quantityMt: Number(amount),
  };

  useEffect(() => {
    if (!(Number(amount) > 0)) return;
    const h = setTimeout(
      () =>
        start(async () =>
          setSim(
            await simulatePlanMove({
              allocationId: move.order.allocationId,
              lineId: move.lineId,
              month: move.month,
              quantityMt: Number(amount),
            }),
          ),
        ),
      200,
    );
    return () => clearTimeout(h);
  }, [amount, move]);

  const from = lines.find((l) => l.id === move.fromLine)?.code;
  const to = lines.find((l) => l.id === move.lineId)?.code;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-md bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-stone-900">Move {move.order.customer}</h2>
        <p className="text-sm text-stone-500">
          {from} · {monthLabel(move.fromMonth)} →{" "}
          <b className="text-stone-900">
            {to} · {monthLabel(move.month)}
          </b>
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm">
          Tonnes to move
          <input type="number" min="0.1" max={move.order.quantityMt} step="0.1" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-24 rounded-sm border border-stone-300 px-2 py-1.5 text-right" />
          <span className="text-stone-500">of {t(move.order.quantityMt)}</span>
        </label>

        {sim && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(["source", "target"] as const).map((k) => {
                const c = sim.cells[k];
                const over = c.after > c.capacity + 0.05;
                return (
                  <div key={k} className={cx("rounded-md p-3", over ? "bg-red-50" : "bg-stone-50")}>
                    <div className="text-xs text-stone-500">
                      {k === "source" ? "From" : "To"} {c.line} · {monthLabel(c.month)}
                    </div>
                    <div className="mt-1 text-sm">
                      {t(c.before)} → <b className={over ? "text-red-700" : "text-stone-900"}>{t(c.after)}</b> of {c.capacity}
                    </div>
                  </div>
                );
              })}
            </div>
            {sim.errors.map((e) => (
              <p key={e} className="rounded-sm bg-red-50 px-3 py-2 text-sm text-red-800">
                ✕ {e}
              </p>
            ))}
            {sim.warnings.map((w) => (
              <p key={w} className="rounded-sm bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {w}
              </p>
            ))}
            {!sim.errors.length && !sim.warnings.length && <p className="rounded-sm bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✓ Fits, no problems.</p>}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-sm border border-stone-300 px-4 py-2 text-sm">
            Cancel
          </button>
          {canApply ? (
            <button
              type="button"
              disabled={pending || !sim || sim.errors.length > 0}
              onClick={() =>
                start(async () => {
                  const r = await applyPlanMove(req);
                  if (r.error) setError(r.error);
                  else onClose();
                })
              }
              className="rounded-sm bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {sim?.warnings.length ? "Move anyway" : "Move it"}
            </button>
          ) : (
            <span className="self-center text-xs text-stone-500">Only the COO or planner can move orders.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-sm font-semibold text-stone-900">{title}</h3>
      {children}
    </section>
  );
}
