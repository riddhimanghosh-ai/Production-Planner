"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { applyPlanMove } from "@/app/actions";
import { monthLabel } from "@/lib/domain";
import type { Suggestion } from "@/lib/recommend";
import { ProductChip } from "./plan-calendar";
import { buttonClass, cx } from "./ui";

const t = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} t`;
const g = "border border-stone-200 px-2 py-1";
const th = "border border-stone-300 bg-stone-100 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-600 whitespace-nowrap";
const sel = "rounded-sm border border-stone-300 bg-white px-1 py-0.5 text-[13px] outline-none focus:border-brand-500";

type PlanLine = { id: number; code: string; productTypes: string[] };

// Planner's to-do: one row per slot to place, pre-filled with the suggested line + month.
export function PlanSuggestions({ items, canEdit, lines, months, free }: { items: Suggestion[]; canEdit: boolean; lines: PlanLine[]; months: string[]; free: Record<string, number> }) {
  const [showAll, setShowAll] = useState(false);
  const action = items.filter((i) => !i.keep);
  const fine = items.filter((i) => i.keep);
  const rows = showAll ? items : action;

  return (
    <section className="rounded-md border border-stone-300 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-300 px-3 py-1.5">
        <span className="text-[13px] text-stone-700">
          <b>{action.length}</b> slot{action.length === 1 ? "" : "s"} to place · suggested line and month are pre-filled
        </span>
        {fine.length > 0 && (
          <button type="button" onClick={() => setShowAll(!showAll)} className="text-xs font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
            {showAll ? "Hide ones that fit" : `Show ${fine.length} that already fit`}
          </button>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-[13px] text-emerald-700">✓ Nothing to place, every new order sits on a good line and month.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="tabular w-full min-w-[760px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={th}>Order</th>
                <th className={th}>Now</th>
                <th className={th}>Move to</th>
                <th className={th}>Result</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <SlotRow key={`${i.allocationId}-${i.moveMt}-${i.best?.lineId}-${i.best?.month}`} i={i} canEdit={canEdit} lines={lines.filter((l) => l.productTypes.includes(i.productType))} months={months} free={free} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SlotRow({ i, canEdit, lines, months, free }: { i: Suggestion; canEdit: boolean; lines: PlanLine[]; months: string[]; free: Record<string, number> }) {
  const fallbackLine = lines.find((l) => l.id !== i.current.lineId)?.id ?? i.current.lineId;
  const suggested = i.best ? { lineId: i.best.lineId, month: i.best.month, qty: i.moveMt } : { lineId: fallbackLine, month: i.deliveryMonth, qty: i.moveMt };
  const [v, setV] = useState(suggested);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const changed = v.lineId !== suggested.lineId || v.month !== suggested.month || v.qty !== suggested.qty;
  const same = v.lineId === i.current.lineId && v.month === i.current.month;
  const room = (free[`${v.lineId}|${v.month}`] ?? 0) + (same ? i.slotMt : 0);
  const left = room - v.qty;
  const late = v.month > i.deliveryMonth;
  const lineCode = lines.find((l) => l.id === v.lineId)?.code ?? "";
  const bad = left < -0.05 || late;

  const allocate = () =>
    start(async () => {
      const r = await applyPlanMove({ allocationId: i.allocationId, lineId: v.lineId, month: v.month, quantityMt: v.qty });
      setMsg(r.error ?? `✓ Moved to ${lineCode}, ${monthLabel(v.month)}`);
    });


  return (
    <tr className="hover:bg-brand-50/60">
      <td className={g}>
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <Link href={`/orders/${i.orderId}`} className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600" title={i.ref}>
            {i.customer}
          </Link>
          <ProductChip p={i.productType} />
        </div>
        <div className="text-[11px] text-stone-500">Deliver {monthLabel(i.deliveryMonth)}</div>
      </td>
      <td className={cx(g, "whitespace-nowrap")}>
        {i.current.line}, {monthLabel(i.current.month)}
        {i.current.problem && <div className="text-[11px] font-semibold text-red-700">{i.current.problem.includes("overbooked") ? "Line full" : i.current.problem}</div>}
      </td>
      <td className={cx(g, "whitespace-nowrap")}>
        <span className="flex items-center gap-1">
          <input
            type="number"
            min="0.1"
            step="0.1"
            max={i.slotMt}
            value={v.qty}
            disabled={!canEdit}
            onChange={(e) => setV({ ...v, qty: Math.min(i.slotMt, Number(e.target.value) || 0) })}
            className={cx(sel, "w-14 text-right")}
            aria-label="Tonnes to move"
          />
          <span className="text-[12px] text-stone-500">t →</span>
          <select value={v.lineId} disabled={!canEdit} onChange={(e) => setV({ ...v, lineId: Number(e.target.value) })} className={sel} aria-label="Line">
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code}
              </option>
            ))}
          </select>
          <select value={v.month} disabled={!canEdit} onChange={(e) => setV({ ...v, month: e.target.value })} className={sel} aria-label="Month">
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          {changed && (
            <button type="button" onClick={() => setV(suggested)} className="text-stone-400 hover:text-stone-700" title="Back to the suggestion">
              ↺
            </button>
          )}
        </span>
      </td>
      <td className={cx(g, "whitespace-nowrap text-[12px]")}>
        {same ? (
          <span className="text-stone-500">No change</span>
        ) : left < -0.05 ? (
          <span className="font-semibold text-red-700">✕ {t(-left)} over</span>
        ) : late ? (
          <span className="font-semibold text-amber-800">After delivery</span>
        ) : (
          <span className="font-semibold text-emerald-700">✓ Fits</span>
        )}
        <span className="ml-1 text-stone-400">({t(Math.max(0, room))} free)</span>
      </td>
      <td className={cx(g, "whitespace-nowrap text-right")}>
        {msg ? (
          <span className="text-[12px] text-stone-700">{msg}</span>
        ) : (
          canEdit && (
            <button type="button" disabled={pending || same || v.qty <= 0} onClick={allocate} className={buttonClass(bad ? "secondary" : "primary", "sm")}>
              {pending ? "…" : "Allocate"}
            </button>
          )
        )}
      </td>
    </tr>
  );
}
