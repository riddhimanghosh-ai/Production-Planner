"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { applyPlanMove, closeDayAction, notRunningAction, resumeDayAction, startDayAction } from "@/app/actions";
import { addMonths, monthLabel } from "@/lib/domain";
import { ProductChip } from "./plan-calendar";
import { buttonClass, cx, tbl } from "./ui";

export type DaySlot = { allocationId: number; orderId: number; ref: string; customer: string; product: string; productType: string; blend: string; planned: number; made: number };
export type DailyLine = { id: number; code: string; dayCapacity: number; monthCapacity: number; runDays: number[]; slots: DaySlot[] };
export type DayLogView = {
  id: number;
  allocationId: number | null;
  capacityT: number;
  lockedAt: string;
  lockedBy: string;
  events: { at: string; by: string; capacityT: number; reason: string }[];
  madeT: number | null;
  closed: boolean;
  stopped: boolean;
};

const t = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} t`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const STOP_REASONS = ["Planned shutdown", "Breakdown", "No power", "No material", "Holiday", "Cleaning / changeover", "Other"];
const REASONS = ["Breakdown", "Maintenance", "Material shortage", "Power cut", "Quality hold", "Other"];

const VARIANT_NAMES: Record<string, string> = { SD: "Spray-dried", AG: "Agglomerated", FDC: "Freeze-dried" };
function labelOf(v: string) {
  const [pt, blend] = v.split(":");
  return `${VARIANT_NAMES[pt] ?? pt}${blend === "CHICORY" ? " + chicory" : ""}`;
}

function runsOn(l: DailyLine, date: string) {
  return l.runDays.includes(new Date(`${date}T00:00:00`).getDay());
}

function dayInfo(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return { n: d.getDate(), wd: d.toLocaleDateString("en-IN", { weekday: "short" }), off: d.getDay() === 0, long: d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" }) };
}

// Daily calendar: one cell per line per day. Lock the day to start it, change capacity mid-day, close it with tonnes made.
export function DailyBoard({
  month,
  months,
  days,
  lines,
  logs,
  canEdit,
  changeoverHours,
  todayIso,
}: {
  month: string;
  months: string[];
  days: string[];
  lines: DailyLine[];
  logs: Record<string, DayLogView>;
  canEdit: boolean;
  changeoverHours: Record<string, number>;
  todayIso: string;
}) {
  const [open, setOpen] = useState<{ lineId: number; date: string } | null>(null);
  // Open on the running day (or the next day still to make), just after the sticky line column.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const cells = [...box.querySelectorAll<HTMLTableCellElement>("td[data-focus]")];
    const target = cells.sort((a, b) => a.offsetLeft - b.offsetLeft)[0];
    const sticky = box.querySelector<HTMLElement>("td.sticky, th.sticky")?.offsetWidth ?? 0;
    if (target) box.scrollLeft = Math.max(0, target.offsetLeft - sticky - 8);
  }, [month]);
  const line = open ? lines.find((l) => l.id === open.lineId) : null;

  return (
    <div className="space-y-4">
      <NowRunning lines={lines} logs={logs} days={days} todayIso={todayIso} onOpen={(lineId, date) => setOpen({ lineId, date })} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex max-w-full overflow-x-auto border border-stone-300 text-[12px]">
          {months.map((m) => (
            <Link key={m} href={`/plan?tab=daily&month=${m}`} className={cx("border-r border-stone-300 px-2 py-1 last:border-r-0", m === month ? "bg-stone-900 text-white" : "hover:bg-stone-50")}>
              {monthLabel(m)}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-4 text-[11px] text-stone-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 border-2 border-brand-600" /> Locked, running
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 bg-emerald-600" /> Closed, on plan
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 bg-red-600" /> Closed, short
          </span>
          <span>Grey = line not scheduled that day</span>
        </div>
      </div>

      {lines.every((l) => l.slots.length === 0) && <p className="border border-stone-300 bg-stone-50 px-3 py-2 text-[13px] text-stone-500">No approved production in {monthLabel(month)} yet. Pick another month above.</p>}

      <div ref={scroller} className="overflow-x-auto border border-stone-300">
        <table className="tabular border-collapse text-[12px]">
          <thead>
            <tr>
              <th className={cx(tbl.th, "sticky left-0 z-20 min-w-32")}>Line</th>
              {days.map((d) => {
                const i = dayInfo(d);
                return (
                  <th key={d} className={cx(tbl.th, "min-w-40 text-left", lines.every((l) => !runsOn(l, d)) && "text-stone-300")}>
                    <span className="text-[13px] text-stone-900">{i.n}</span> <span className="normal-case tracking-normal">{i.wd}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <LineRow key={l.id} l={l} days={days} logs={logs} month={month} canEdit={canEdit} changeoverHours={changeoverHours} onOpen={(d) => setOpen({ lineId: l.id, date: d })} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-stone-500">Click a day to lock the line for the shift, change its capacity during the day, or close the day with tonnes made. Daily tonnes add up into the month.</p>

      {open && line && (
        <DayDrawer
          key={`${open.lineId}-${open.date}-${logs[`${open.lineId}|${open.date}`]?.events.length ?? 0}-${logs[`${open.lineId}|${open.date}`]?.closed}`}
          line={line}
          date={open.date}
          log={logs[`${open.lineId}|${open.date}`]}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

// What each line is doing right now, in plain words: the order, the product, since when, and how far along.
function NowRunning({ lines, logs, days, todayIso, onOpen }: { lines: DailyLine[]; logs: Record<string, DayLogView>; days: string[]; todayIso: string; onOpen: (lineId: number, date: string) => void }) {
  const inMonth = days.includes(todayIso);
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-700">Now running</div>
        <div className="text-[11px] text-stone-500">{new Date(`${todayIso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {lines.map((l) => {
          // The open (locked, not closed) day if there is one, else today's log, else the next planned day.
          const openDay = days.find((d) => logs[`${l.id}|${d}`] && !logs[`${l.id}|${d}`].closed && !logs[`${l.id}|${d}`].stopped);
          const date = openDay ?? (inMonth ? todayIso : days[0]);
          const log = logs[`${l.id}|${date}`];
          const slot = log ? l.slots.find((s) => s.allocationId === log.allocationId) : l.slots.find((s) => s.made < s.planned - 0.05);
          const state = log?.stopped ? "stopped" : log && !log.closed ? "running" : log?.closed ? "closed" : "idle";
          const left = slot ? Math.max(0, Math.round((slot.planned - slot.made) * 10) / 10) : 0;
          const daysLeft = slot && l.dayCapacity ? Math.ceil(left / l.dayCapacity) : 0;
          const tone = state === "running" ? "border-brand-600" : state === "stopped" ? "border-red-600" : state === "closed" ? "border-emerald-600" : "border-stone-300";
          return (
            <button key={l.id} type="button" onClick={() => onOpen(l.id, date)} className={cx("border border-stone-300 border-l-[3px] bg-white p-3 text-left hover:bg-stone-50", tone)}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[15px] font-semibold text-stone-900">{l.code}</span>
                <span className={cx("font-mono text-[10px] uppercase tracking-[0.12em]", state === "running" ? "text-brand-600" : state === "stopped" ? "text-red-700" : state === "closed" ? "text-emerald-700" : "text-stone-400")}>
                  {state === "running" ? `Running since ${time(log!.lockedAt)}` : state === "stopped" ? "Not running" : state === "closed" ? `Closed · made ${t(log!.madeT ?? 0)}` : "Not started"}
                </span>
              </div>
              {state === "stopped" ? (
                <div className="mt-1 text-[13px] text-stone-700">{log?.events.at(-1)?.reason.replace(/^Not running: /, "")}</div>
              ) : slot ? (
                <>
                  <div className="mt-1 truncate text-[13px] font-medium text-stone-900" title={slot.product}>
                    {slot.customer} <span className="font-normal text-stone-500">· {slot.ref}</span>
                  </div>
                  <div className="truncate text-[12px] text-stone-600">{slot.product}</div>
                  <div className="mt-2 flex items-baseline justify-between text-[12px] text-stone-600">
                    <span>
                      Today <b className="text-stone-900">{t(log && !log.closed ? log.capacityT : l.dayCapacity)}</b>
                    </span>
                    <span>
                      Order <b className="text-stone-900">{t(slot.made)}</b> of {t(slot.planned)}
                      {left > 0.05 && ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                    </span>
                  </div>
                  <div className="mt-1 h-1 bg-stone-200">
                    <div className="h-full bg-emerald-600" style={{ width: `${Math.min(100, (slot.made / (slot.planned || 1)) * 100)}%` }} />
                  </div>
                </>
              ) : (
                <div className="mt-1 text-[13px] text-stone-500">Idle, no order planned</div>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// Plan every day of the month for one line: closed days keep what was made; the rest of the orders'
// tonnes (including any short days) are spread over the open days at day capacity. Whatever does not
// fit before month end is flagged with a button to move it to next month.
function LineRow({ l, days, logs, month, canEdit, changeoverHours, onOpen }: { l: DailyLine; days: string[]; logs: Record<string, DayLogView>; month: string; canEdit: boolean; changeoverHours: Record<string, number>; onOpen: (d: string) => void }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const made = days.reduce((a, d) => a + (logs[`${l.id}|${d}`]?.madeT ?? 0), 0);
  const planned = l.slots.reduce((a, s) => a + s.planned, 0);

  // Queue of tonnes still to make, order by order.
  // Run the same product and blend back to back (pure before chicory, spray-dried before agglomerated) to keep cleaning to a minimum.
  const variant = (x: DaySlot) => `${x.productType}:${x.blend}`;
  const rank = (x: DaySlot) => (x.blend === "CHICORY" ? 2 : 0) + (x.productType === "SD" ? 0 : 1);
  const queue = [...l.slots].sort((a, b) => rank(a) - rank(b)).map((s) => ({ slot: s, left: Math.max(0, s.planned - s.made) }));
  const plan: Record<string, { tonnes: number; slot?: DaySlot; changeover?: { label: string; hours: number; lostMt: number } }> = {};
  let lastVariant: string | null = null;
  const hoursFor = (from: string, to: string) => {
    const [fp, fb] = from.split(":");
    const [tp, tb] = to.split(":");
    return (fp !== tp ? (changeoverHours[`${fp}_${tp}`] ?? 4) : 0) + (fb !== tb ? (changeoverHours[`${fb}_${tb}`] ?? 4) : 0);
  };
  for (const d of days) {
    if (!runsOn(l, d)) continue;
    const log = logs[`${l.id}|${d}`];
    if (log?.stopped) continue;
    if (log?.closed) {
      const done = l.slots.find((s) => s.allocationId === log.allocationId);
      plan[d] = { tonnes: l.dayCapacity, slot: done };
      if (done) lastVariant = variant(done);
      continue;
    }
    let room = log ? log.capacityT : l.dayCapacity;
    let first: DaySlot | undefined = log ? l.slots.find((s) => s.allocationId === log.allocationId) : undefined;
    let tonnes = 0;
    let changeover: { label: string; hours: number; lostMt: number } | undefined;
    for (const q of queue) {
      if (room <= 0.05) break;
      if (q.left <= 0.05) continue;
      // Switching to another product or blend costs cleaning time out of today's capacity.
      if (lastVariant && lastVariant !== variant(q.slot)) {
        const hours = hoursFor(lastVariant, variant(q.slot));
        const lostMt = Math.round((hours / 24) * l.dayCapacity * 10) / 10;
        changeover = { label: `${labelOf(lastVariant)} → ${labelOf(variant(q.slot))}`, hours, lostMt };
        room -= lostMt;
        if (room <= 0.05) {
          lastVariant = variant(q.slot);
          break;
        }
      }
      lastVariant = variant(q.slot);
      const take = Math.min(room, q.left);
      if (take <= 0.05) continue;
      q.left -= take;
      room -= take;
      tonnes += take;
      first ??= q.slot;
    }
    if (tonnes > 0.05 || log || changeover) plan[d] = { tonnes: Math.round(tonnes * 10) / 10, slot: first ?? queue.find((q) => q.left > 0.05)?.slot, changeover };
  }
  const overflow = Math.round(queue.reduce((a, q) => a + q.left, 0) * 10) / 10;
  const overflowSlot = [...queue].reverse().find((q) => q.left > 0.05)?.slot;
  const nextMonth = addMonths(month, 1);

  return (
    <tr className="align-top">
      <td className="sticky left-0 z-10 border border-stone-300 bg-white px-2 py-2">
        <div className="text-[13px] font-medium">{l.code}</div>
        <table className="mt-1 text-[11px] text-stone-500">
          <tbody>
            <tr>
              <td className="border-0 p-0 pr-2">Capacity</td>
              <td className="border-0 p-0 text-right text-stone-900">{t(l.monthCapacity)} / month</td>
            </tr>
            <tr>
              <td className="border-0 p-0 pr-2" />
              <td className="border-0 p-0 text-right text-stone-900">{t(l.dayCapacity)} / day</td>
            </tr>
          </tbody>
        </table>
        <div className={cx("mt-2 text-[11px]", made >= planned - 0.05 && planned > 0 ? "text-emerald-700" : "text-stone-700")}>
          Made {t(made)}
          <br />
          of {t(planned)} this month
        </div>
        {overflow > 0.05 && overflowSlot && (
          <div className="mt-2 border-t border-stone-200 pt-2 text-[11px] text-red-700">
            {t(overflow)} won&apos;t fit in {monthLabel(month)}
            {canEdit &&
              (msg ? (
                <div className="mt-1 text-stone-700">{msg}</div>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => start(async () => setMsg((await applyPlanMove({ allocationId: overflowSlot.allocationId, lineId: l.id, month: nextMonth, quantityMt: overflow })).error ?? `Moved to ${monthLabel(nextMonth)}`))}
                  className="mt-1 block border border-stone-900 px-1.5 py-0.5 font-medium text-stone-900 hover:border-brand-600 hover:text-brand-600"
                >
                  Move {t(overflow)} to {monthLabel(nextMonth)}
                </button>
              ))}
          </div>
        )}
      </td>
      {days.map((d) => {
        const i = { ...dayInfo(d), off: !runsOn(l, d) };
        const log = logs[`${l.id}|${d}`];
        const p = plan[d];
        const madeNow = log?.madeT ?? 0;
        const short = log?.closed ? Math.max(0, Math.round((l.dayCapacity - madeNow) * 10) / 10) : 0;
        const lastChange = log && log.events.length > 1 ? log.events[log.events.length - 1] : null;
        const state = !log ? "To make" : !log.closed ? "Running" : short > 0.05 ? "Short" : "Made";
        return (
          <td
            key={d}
            data-focus={(log && !log.closed) || (!log && !i.off && p?.slot) ? "1" : undefined}
            onClick={() => !i.off && onOpen(d)}
            className={cx(
              "h-32 border border-stone-300 p-2",
              i.off ? "bg-stone-100" : log?.stopped ? "cursor-pointer bg-stone-100 hover:bg-stone-50" : "cursor-pointer hover:bg-stone-50",
              log && !log.closed && "outline outline-2 -outline-offset-2 outline-brand-600",
              short > 0.05 && "bg-red-50",
            )}
          >
            {i.off ? (
              <span className="text-[11px] text-stone-400">Off</span>
            ) : log?.stopped ? (
              <div className="space-y-1">
                <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-red-700">Not running</div>
                <div className="text-[11px] text-stone-600">{log.events.at(-1)?.reason.replace(/^Not running: /, "")}</div>
                <div className="text-[10px] text-stone-500">Plan moved to later days</div>
              </div>
            ) : !p?.slot ? (
              <span className="text-[11px] text-stone-400">Idle, no order</span>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <ProductChip p={p.slot.productType} />
                  <span className={cx("font-mono text-[10px] uppercase tracking-[0.1em]", state === "To make" ? "text-stone-400" : state === "Running" ? "text-brand-600" : state === "Short" ? "text-red-700" : "text-emerald-700")}>{state}</span>
                </div>
                <div className="truncate text-[11px] text-stone-700" title={p.slot.product}>
                  {p.slot.customer}
                </div>
                <table className="w-full text-[11px]">
                  <tbody>
                    <tr>
                      <td className="border-0 p-0 text-stone-500">Plan</td>
                      <td className="border-0 p-0 text-right font-medium">{t(log?.closed ? l.dayCapacity : p.tonnes)}</td>
                    </tr>
                    <tr>
                      <td className="border-0 p-0 text-stone-500">Made</td>
                      <td className={cx("border-0 p-0 text-right font-semibold", !log?.closed ? "text-stone-300" : short > 0.05 ? "text-red-700" : "text-emerald-700")}>{log?.closed ? t(madeNow) : "–"}</td>
                    </tr>
                  </tbody>
                </table>
                {p.changeover && !log?.closed && (
                  <div className="text-[10px] font-semibold text-stone-700" title="Cleaning time when the line switches product or blend">
                    Changeover {p.changeover.label} · {p.changeover.hours} h · −{p.changeover.lostMt} t
                  </div>
                )}
                {short > 0.05 && (
                  <div className="text-[10px] text-red-700">
                    {lastChange ? `${lastChange.reason.split(":")[0]}. ` : ""}
                    {t(short)} short, added to later days
                  </div>
                )}
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function DayDrawer({ line, date, log, canEdit, onClose }: { line: DailyLine; date: string; log?: DayLogView; canEdit: boolean; onClose: () => void }) {
  const info = dayInfo(date);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<number | "">(line.slots.find((s) => s.made < s.planned)?.allocationId ?? line.slots[0]?.allocationId ?? "");
  const [cap, setCap] = useState(String(line.dayCapacity));
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState("");
  const [made, setMade] = useState(String(log?.madeT ?? line.dayCapacity));
  const [choice, setChoice] = useState<"run" | "stop">("run");
  const isShort = made !== "" && Number(made) < line.dayCapacity - 0.05;
  const [stopReason, setStopReason] = useState(STOP_REASONS[0]);
  const [stopNote, setStopNote] = useState("");
  const act = (fn: () => Promise<{ error: string | null }>) => start(async () => setError((await fn()).error));
  const running = log ? line.slots.find((s) => s.allocationId === log.allocationId) : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-y-auto border-l border-stone-300 bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-stone-300 pb-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">{line.code}</div>
            <h2 className="text-[22px] font-medium tracking-[-0.02em]">{info.long}</h2>
            <div className="mt-1 text-[13px] text-stone-500">
              Normal capacity {t(line.dayCapacity)} a day · {t(line.monthCapacity)} a month
            </div>
          </div>
          <button type="button" onClick={onClose} className="px-2 py-1 text-stone-500 hover:text-stone-900" aria-label="Close">
            ✕
          </button>
        </div>

        {error && <p className="mt-4 border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>}

        {log?.stopped && (
          <section className="mt-6 space-y-3 border border-stone-300 bg-stone-50 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-red-700">Not running today</div>
            <p className="text-[13px] text-stone-700">{log.events.at(-1)?.reason.replace(/^Not running: /, "")}</p>
            <p className="text-[12px] text-stone-500">Marked by {log.lockedBy}. The day&apos;s plan has moved to the next running days.</p>
            {canEdit && (
              <button type="button" disabled={pending} onClick={() => act(() => resumeDayAction(log.id))} className={buttonClass("secondary")}>
                Run this day after all
              </button>
            )}
          </section>
        )}

        {!log && (
          <section className="mt-6 space-y-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">Start of day</div>
            <h3 className="text-[17px] font-medium tracking-[-0.01em]">Is {line.code} running today?</h3>
            <div className="grid grid-cols-2 border border-stone-300 text-[13px]">
              <button type="button" onClick={() => setChoice("run")} className={cx("border-r border-stone-300 px-3 py-2 font-medium", choice === "run" ? "bg-stone-900 text-white" : "hover:bg-stone-50")}>
                Yes, running
              </button>
              <button type="button" onClick={() => setChoice("stop")} className={cx("px-3 py-2 font-medium", choice === "stop" ? "bg-stone-900 text-white" : "hover:bg-stone-50")}>
                Not running
              </button>
            </div>

            {choice === "run" ? (
              <div className="space-y-3">
                <label className="block text-[13px]">
                  <span className="text-stone-500">Running order</span>
                  <select value={slot} onChange={(e) => setSlot(e.target.value ? Number(e.target.value) : "")} disabled={!canEdit} className={cx(tbl.input, "mt-1 block w-full py-1")}>
                    {line.slots.length === 0 && <option value="">No approved order this month</option>}
                    {line.slots.map((s) => (
                      <option key={s.allocationId} value={s.allocationId}>
                        {s.customer} · {t(s.made)} of {t(s.planned)} made
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[13px]">
                  <span className="text-stone-500">Planned for today (t)</span>
                  <input type="number" min="0" step="0.1" value={cap} disabled={!canEdit} onChange={(e) => setCap(e.target.value)} className={cx(tbl.input, "mt-1 block w-32 py-1 text-right")} />
                </label>
                {canEdit && (
                  <button type="button" disabled={pending} onClick={() => act(() => startDayAction(line.id, date, slot === "" ? null : slot, Number(cap)))} className={buttonClass("primary")}>
                    Lock and start the day
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block text-[13px]">
                  <span className="text-stone-500">Why</span>
                  <select value={stopReason} onChange={(e) => setStopReason(e.target.value)} className={cx(tbl.input, "mt-1 block w-full py-1")}>
                    {STOP_REASONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <input value={stopNote} onChange={(e) => setStopNote(e.target.value)} placeholder="Details (optional)" className={cx(tbl.input, "w-full py-1")} />
                {canEdit && (
                  <button type="button" disabled={pending} onClick={() => act(() => notRunningAction(line.id, date, stopNote.trim() ? `${stopReason}, ${stopNote.trim()}` : stopReason))} className={buttonClass("danger")}>
                    Mark not running today
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {log && !log.stopped && (
          <>
            <section className="mt-6">
              <div className="flex items-center justify-between">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">{log.closed ? "Day closed" : "Locked, running"}</div>
                <span className={cx("border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.12em]", log.closed ? "border-stone-300 text-stone-500" : "border-brand-600 text-brand-600")}>{log.closed ? "Closed" : "Locked"}</span>
              </div>
              <table className={cx(tbl.table, "mt-2 border border-stone-300")}>
                <tbody>
                  <tr>
                    <td className={cx(tbl.td, "w-36 text-stone-500")}>Locked at</td>
                    <td className={tbl.td}>
                      {time(log.lockedAt)} by {log.lockedBy}
                    </td>
                  </tr>
                  <tr>
                    <td className={cx(tbl.td, "text-stone-500")}>Running</td>
                    <td className={tbl.td}>
                      {running ? (
                        <>
                          <div className="font-medium text-stone-900">
                            {running.customer} <span className="font-normal text-stone-500">· {running.ref}</span>
                          </div>
                          <div className="text-[12px] text-stone-600">{running.product}</div>
                          <div className="text-[12px] text-stone-600">
                            Order {t(running.made)} of {t(running.planned)} made
                          </div>
                        </>
                      ) : (
                        "No order"
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className={cx(tbl.td, "text-stone-500")}>Planned</td>
                    <td className={tbl.td}>{t(line.dayCapacity)}</td>
                  </tr>
                  {log.closed && (
                    <tr>
                      <td className={cx(tbl.td, "text-stone-500")}>Made</td>
                      <td className={cx(tbl.td, "font-semibold", (log.madeT ?? 0) < line.dayCapacity - 0.05 ? "text-red-700" : "text-emerald-700")}>{t(log.madeT ?? 0)}</td>
                    </tr>
                  )}
                  {log.closed && log.events.length > 1 && (
                    <tr>
                      <td className={cx(tbl.td, "text-stone-500")}>Reason</td>
                      <td className={tbl.td}>{log.events.at(-1)?.reason}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            {canEdit && (
              <section className="mt-6 space-y-3 border border-stone-300 p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">{log.closed ? "Correct the day" : "End of day"}</div>
                <div className="flex items-center gap-2 text-[13px]">
                  <input type="number" min="0" step="0.1" value={made} onChange={(e) => setMade(e.target.value)} className={cx(tbl.input, "w-24 py-1 text-right")} aria-label="Tonnes made today" />
                  <span className="text-stone-500">t made today, plan was {t(line.dayCapacity)}</span>
                </div>
                {isShort && (
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="text-red-700">Short {t(line.dayCapacity - Number(made))}, why?</span>
                    <select value={reason} onChange={(e) => setReason(e.target.value)} className={cx(tbl.input, "py-1")}>
                      {REASONS.map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Details (optional)" className={cx(tbl.input, "min-w-40 flex-1 py-1")} />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" disabled={pending || made === ""} onClick={() => act(() => closeDayAction(log.id, Number(made), isShort ? (note.trim() ? `${reason}: ${note.trim()}` : reason) : ""))} className={buttonClass("primary")}>
                    {log.closed ? "Save" : "Close the day"}
                  </button>
                  {!log.closed && (
                    <button type="button" disabled={pending} onClick={() => act(() => notRunningAction(line.id, date, "Stopped during the shift"))} className="text-[12px] text-red-700 underline underline-offset-2">
                      Line stopped, not running today
                    </button>
                  )}
                </div>
              </section>
            )}
          </>
        )}

        <section className="mt-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">Approved orders on {line.code} this month</div>
          <table className={cx(tbl.table, "mt-2 border border-stone-300")}>
            <thead>
              <tr>
                <th className={tbl.th}>Order</th>
                <th className={tbl.thR}>Made</th>
                <th className={tbl.thR}>Plan</th>
              </tr>
            </thead>
            <tbody>
              {line.slots.length === 0 && (
                <tr>
                  <td colSpan={3} className={cx(tbl.td, "text-stone-500")}>
                    None
                  </td>
                </tr>
              )}
              {line.slots.map((s) => (
                <tr key={s.allocationId}>
                  <td className={tbl.td}>{s.customer}</td>
                  <td className={cx(tbl.tdR, s.made >= s.planned - 0.05 ? "text-emerald-700" : "")}>{t(s.made)}</td>
                  <td className={tbl.tdR}>{t(s.planned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </aside>
    </div>
  );
}
