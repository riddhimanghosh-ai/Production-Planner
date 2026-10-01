"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { carryOverAction, recordProductionAction } from "@/app/actions";
import { addMonths, monthLabel } from "@/lib/domain";
import { ProductChip } from "./plan-calendar";
import { buttonClass, cx, tbl } from "./ui";

export type ProductionRow = { month: string; allocationId: number; orderId: number; customer: string; product: string; productType: string; line: string; planned: number; made: number | null; note: string };
export type MonthTally = { month: string; planned: number; made: number; slots: number; recorded: number };

const t = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} t`;

export function statusOf(planned: number, made: number | null) {
  if (made == null) return { label: "Not recorded", cls: "text-stone-500" };
  if (made >= planned - 0.05) return { label: made > planned + 0.05 ? "Done, over" : "Done", cls: "font-semibold text-emerald-700" };
  if (made <= 0) return { label: "Not made", cls: "font-semibold text-red-700" };
  return { label: `Short ${t(planned - made)}`, cls: "font-semibold text-red-700" };
}

// Execution checklist: for each approved slot in a month, the planner records what was actually made.
export function ProductionLog({ month, tallies, rows, canEdit }: { month: string; tallies: MonthTally[]; rows: ProductionRow[]; canEdit: boolean }) {
  const planned = rows.reduce((a, r) => a + r.planned, 0);
  const made = rows.reduce((a, r) => a + (r.made ?? 0), 0);
  const recorded = rows.filter((r) => r.made != null).length;

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto border border-stone-300">
        <table className="tabular w-full text-[13px]">
          <thead>
            <tr>
              <th className={tbl.th}>Month</th>
              {tallies.map((m) => (
                <th key={m.month} className={cx(tbl.thR, m.month === month && "text-stone-900")}>
                  <Link href={`/plan?tab=done&month=${m.month}`} className={cx("hover:text-stone-900", m.month === month && "border-b-2 border-brand-600 pb-0.5")}>
                    {monthLabel(m.month)}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={cx(tbl.td, "text-stone-500")}>Made / planned</td>
              {tallies.map((m) => (
                <td key={m.month} className={cx(tbl.tdR, m.recorded === 0 ? "text-stone-400" : m.made >= m.planned - 0.05 ? "text-emerald-700" : "text-red-700")}>
                  {m.slots ? `${Math.round(m.made)} / ${Math.round(m.planned)}` : "–"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap border-t border-stone-900 border-b border-b-stone-300">
        {[
          ["Planned", t(planned)],
          ["Made", t(made)],
          ["Slots recorded", `${recorded} of ${rows.length}`],
        ].map(([k, v]) => (
          <div key={k} className="min-w-40 flex-1 border-r border-stone-300 px-4 py-3 last:border-r-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">{k}</div>
            <div className="tabular mt-1 text-[26px] leading-none tracking-[-0.035em]">{v}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="border border-stone-300 bg-stone-50 p-4 text-[13px] text-stone-500">No approved production planned in {monthLabel(month)}.</p>
      ) : (
        <div className={tbl.wrap}>
          <table className={cx(tbl.table, "min-w-[860px]")}>
            <thead>
              <tr>
                <th className={tbl.th}>Order</th>
                <th className={tbl.th}>Line</th>
                <th className={tbl.thR}>Planned</th>
                <th className={tbl.th}>Made</th>
                <th className={tbl.th}>Status</th>
                <th className={tbl.th}>Note</th>
                <th className={tbl.th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={`${r.allocationId}-${r.made}`} r={r} canEdit={canEdit} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ r, canEdit }: { r: ProductionRow; canEdit: boolean }) {
  const [made, setMade] = useState(r.made == null ? "" : String(r.made));
  const [note, setNote] = useState(r.note);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const st = statusOf(r.planned, r.made);
  const dirty = made !== (r.made == null ? "" : String(r.made)) || note !== r.note;

  return (
    <tr className={tbl.tr}>
      <td className={tbl.td}>
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <Link href={`/orders/${r.orderId}`} className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
            {r.customer}
          </Link>
          <ProductChip p={r.productType} />
        </div>
      </td>
      <td className={cx(tbl.td, "whitespace-nowrap")}>{r.line}</td>
      <td className={tbl.tdR}>{t(r.planned)}</td>
      <td className={cx(tbl.td, "whitespace-nowrap")}>
        <span className="flex items-center gap-1">
          <input type="number" min="0" step="0.1" value={made} disabled={!canEdit} onChange={(e) => setMade(e.target.value)} placeholder="0" className={cx(tbl.input, "w-20 text-right")} aria-label="Tonnes made" />
          <span className="text-[12px] text-stone-500">t</span>
          {canEdit && r.made == null && (
            <button type="button" onClick={() => setMade(String(r.planned))} className="ml-1 text-[11px] text-stone-500 underline underline-offset-2 hover:text-stone-900">
              All
            </button>
          )}
        </span>
      </td>
      <td className={cx(tbl.td, "whitespace-nowrap", st.cls)}>
        {st.label}
        {canEdit && r.made != null && r.made < r.planned - 0.05 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setError((await carryOverAction(r.allocationId)).error))}
            className="ml-2 border border-stone-900 px-1.5 py-px text-[11px] font-medium text-stone-900 hover:border-brand-600 hover:text-brand-600"
          >
            Move {t(r.planned - r.made)} to {monthLabel(addMonths(r.month, 1))}
          </button>
        )}
      </td>
      <td className={tbl.td}>
        <input value={note} disabled={!canEdit} onChange={(e) => setNote(e.target.value)} placeholder="Batch no., reason if short" className={cx(tbl.input, "w-full min-w-40")} aria-label="Note" />
      </td>
      <td className={cx(tbl.td, "whitespace-nowrap text-right")}>
        {canEdit && (
          <button
            type="button"
            disabled={pending || !dirty || made === ""}
            onClick={() =>
              start(async () => {
                const res = await recordProductionAction(r.allocationId, Number(made), note);
                setError(res.error);
              })
            }
            className={buttonClass("primary", "sm")}
          >
            {pending ? "Saving" : "Record"}
          </button>
        )}
        {error && <div className="text-[11px] text-red-700">{error}</div>}
      </td>
    </tr>
  );
}
