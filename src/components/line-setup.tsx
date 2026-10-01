"use client";

import { useState, useTransition } from "react";
import { lineSetupAction } from "@/app/actions";
import { PRODUCT_HINTS, PRODUCT_TYPES, type ProductType } from "@/lib/domain";
import { buttonClass, cx, tbl } from "./ui";

type LineView = { id: number; code: string; name: string; capacityMt: number; productTypes: string[]; productCaps: Record<string, number>; active: boolean; capacityConfirmed: boolean; runDays?: number[] };

// Monday first, as the factory reads a week. Values are JS weekdays (0 = Sunday).
const WEEK = [
  [1, "M", "Monday"],
  [2, "T", "Tuesday"],
  [3, "W", "Wednesday"],
  [4, "T", "Thursday"],
  [5, "F", "Friday"],
  [6, "S", "Saturday"],
  [0, "S", "Sunday"],
] as const;
export const DEFAULT_RUN_DAYS = [1, 2, 3, 4, 5, 6];
const PRODUCTS = Object.keys(PRODUCT_TYPES) as ProductType[];

// Capacity is set per line and per product; the line's normal capacity is the sum. 0 t means the line does not make it.
export function LineSetup({ lines, editable }: { lines: LineView[]; editable: boolean }) {
  const totals = PRODUCTS.map((pt) => lines.filter((l) => l.active).reduce((a, l) => a + (l.productCaps[pt] ?? 0), 0));
  return (
    <div className="space-y-2">
      <div className={tbl.wrap}>
        <table className={tbl.table}>
          <thead>
            <tr>
              <th className={tbl.th} rowSpan={2}>
                Line
              </th>
              <th className={tbl.th} rowSpan={2}>
                Running
              </th>
              <th className={cx(tbl.th, "text-center")} colSpan={PRODUCTS.length}>
                Normal capacity by product, t / month
              </th>
              <th className={tbl.thR} rowSpan={2}>
                Line total
              </th>
              <th className={tbl.th} rowSpan={2}>
                Runs on
              </th>
              <th className={tbl.th} rowSpan={2} />
            </tr>
            <tr>
              {PRODUCTS.map((pt) => (
                <th key={pt} className={tbl.thR} title={PRODUCT_HINTS[pt]}>
                  {PRODUCT_TYPES[pt]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <LineRow key={l.id} line={l} editable={editable} />
            ))}
            <tr className="bg-stone-50">
              <td className={cx(tbl.td, "font-medium")} colSpan={2}>
                All lines
              </td>
              {totals.map((v, i) => (
                <td key={PRODUCTS[i]} className={cx(tbl.tdR, "font-semibold", !v && "text-stone-400")}>
                  {v ? `${v} t` : "–"}
                </td>
              ))}
              <td className={cx(tbl.tdR, "font-semibold")}>{totals.reduce((a, v) => a + v, 0)} t</td>
              <td className={tbl.td} colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-stone-500">Enter each product&apos;s share of the line. The line total adds up automatically. Leave a product at 0 if the line doesn&apos;t make it.</p>
    </div>
  );
}

function LineRow({ line, editable }: { line: LineView; editable: boolean }) {
  const [caps, setCaps] = useState<Record<string, number>>(Object.fromEntries(PRODUCTS.map((pt) => [pt, line.productTypes.includes(pt) ? Math.round(line.productCaps[pt] ?? 0) : 0])));
  const [active, setActive] = useState(line.active);
  const [runDays, setRunDays] = useState<number[]>(line.runDays ?? DEFAULT_RUN_DAYS);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const total = Object.values(caps).reduce((a, v) => a + (Number(v) || 0), 0);
  const toggleDay = (d: number) => setRunDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]));

  return (
    <tr className={cx(tbl.tr, !active && "bg-stone-50 text-stone-400")}>
      <td className={cx(tbl.td, "font-semibold text-stone-900")}>{line.code}</td>
      <td className={tbl.td}>
        <input type="checkbox" checked={active} disabled={!editable} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-brand-600" aria-label={`${line.code} running`} />
      </td>
      {PRODUCTS.map((pt) => (
        <td key={pt} className={tbl.tdR}>
          <input
            type="number"
            min="0"
            value={caps[pt] || ""}
            placeholder="0"
            disabled={!editable}
            onChange={(e) => setCaps((c) => ({ ...c, [pt]: Number(e.target.value) || 0 }))}
            className={cx(tbl.input, "w-20 text-right", !caps[pt] && "text-stone-400")}
            aria-label={`${line.code} ${PRODUCT_TYPES[pt]} tonnes`}
          />
        </td>
      ))}
      <td className={cx(tbl.tdR, "text-[15px] font-semibold text-stone-900")}>{total} t</td>
      <td className={cx(tbl.td, "whitespace-nowrap")}>
        <div className="inline-flex border border-stone-300">
          {WEEK.map(([d, short, name]) => (
            <button
              key={d}
              type="button"
              disabled={!editable}
              onClick={() => toggleDay(d)}
              title={name}
              aria-pressed={runDays.includes(d)}
              className={cx("w-6 border-r border-stone-300 py-0.5 font-mono text-[11px] last:border-r-0", runDays.includes(d) ? "bg-stone-900 text-white" : "bg-white text-stone-400 hover:text-stone-900")}
            >
              {short}
            </button>
          ))}
        </div>
        <span className="ml-2 text-[11px] text-stone-500">{runDays.length} days</span>
      </td>
      <td className={cx(tbl.td, "whitespace-nowrap")}>
        {editable && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await lineSetupAction(line.id, { capacityMt: total, productTypes: Object.keys(caps).filter((p) => caps[p] > 0), active, capacityConfirmed: line.capacityConfirmed, runDays, productCaps: caps });
                setMsg(r.error ?? "Saved");
              })
            }
            className={buttonClass("primary", "sm")}
          >
            Save
          </button>
        )}
        {msg && <span className="ml-2 text-[11px] text-stone-600">{msg}</span>}
      </td>
    </tr>
  );
}
