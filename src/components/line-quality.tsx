"use client";

import { useState } from "react";
import type { Alert, Series } from "@/lib/quality";
import { cx, tbl } from "./ui";

export type LineQuality = { code: string; running: string | null; series: Series[]; alerts: Alert[]; lots: { lotNo: string; moisturePct: number | null; qc: string; date: string }[] };

// Line quality: live readings against target bands, a trend prediction, alerts, and recent lot results.
export function LineQualityBoard({ lines }: { lines: LineQuality[] }) {
  const [code, setCode] = useState(lines.find((l) => l.running)?.code ?? lines[0]?.code);
  const line = lines.find((l) => l.code === code) ?? lines[0];
  const [alerts, setAlerts] = useState<Record<string, boolean>>({});
  if (!line) return null;
  const isOn = (a: Alert) => alerts[`${line.code}|${a.metric}|${a.when}`] ?? a.active;
  const out = line.series.filter((s) => s.status === "out").length;
  const watch = line.series.filter((s) => s.status === "watch").length;
  const predictions = line.series.map((s) => s.prediction).filter((p): p is string => !!p);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex border border-stone-300 text-[13px]">
          {lines.map((l) => {
            const lo = l.series.filter((s) => s.status === "out").length;
            return (
              <button
                key={l.code}
                type="button"
                onClick={() => setCode(l.code)}
                className={cx("flex items-center gap-1.5 border-r border-stone-300 px-3 py-1 font-semibold last:border-r-0", l.code === code ? "bg-stone-900 text-white" : "text-stone-600 hover:text-stone-900")}
              >
                {l.code}
                {l.running && <span className={cx("h-1.5 w-1.5", lo ? "bg-red-600" : l.code === code ? "bg-white" : "bg-emerald-600")} />}
              </button>
            );
          })}
        </div>
        <div className="text-[13px] text-stone-600">{line.running ? <>Running {line.running}</> : "Not running now, last readings shown"}</div>
        <div className={cx("ml-auto text-[13px] font-semibold", out ? "text-red-700" : watch ? "text-stone-900" : "text-emerald-700")}>
          {out ? `${out} reading${out > 1 ? "s" : ""} out of range` : watch ? `${watch} to watch` : "All readings in range"}
        </div>
      </div>

      {predictions.length > 0 && (
        <div className="border border-stone-300 border-l-[3px] border-l-brand-600 bg-white px-3 py-2 text-[13px]">
          <span className="mr-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-600">Prediction</span>
          {predictions.join(" ")}
          <span className="ml-1 text-stone-500">(from the last hour&apos;s trend)</span>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {line.series.map((s) => (
          <Chart key={s.metric.key} s={s} />
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section>
          <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-700">Alerts</div>
          <div className={tbl.wrap}>
            <table className={tbl.table}>
              <thead>
                <tr>
                  <th className={tbl.th}>On</th>
                  <th className={tbl.th}>Reading</th>
                  <th className={tbl.th}>Alert when</th>
                  <th className={tbl.th}>Now</th>
                </tr>
              </thead>
              <tbody>
                {line.alerts.map((a) => {
                  const s = line.series.find((x) => x.metric.label === a.metric)!;
                  const firing = isOn(a) && (a.when.startsWith("above") ? s.now > s.metric.high : s.now < s.metric.low);
                  return (
                    <tr key={a.metric + a.when} className={cx(tbl.tr, firing && "bg-red-50")}>
                      <td className={tbl.td}>
                        <input type="checkbox" checked={isOn(a)} onChange={(e) => setAlerts((x) => ({ ...x, [`${line.code}|${a.metric}|${a.when}`]: e.target.checked }))} className="h-4 w-4 accent-brand-600" aria-label={`${a.metric} ${a.when}`} />
                      </td>
                      <td className={cx(tbl.td, "font-medium")}>{a.metric}</td>
                      <td className={tbl.td}>{a.when}</td>
                      <td className={cx(tbl.td, "font-semibold", firing ? "text-red-700" : "text-stone-500")}>{firing ? `Firing: ${s.now.toFixed(s.metric.decimals)}${s.metric.unit}` : isOn(a) ? "Quiet" : "Off"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-700">Recent lots from this line</div>
          <div className={tbl.wrap}>
            <table className={tbl.table}>
              <thead>
                <tr>
                  <th className={tbl.th}>Lot</th>
                  <th className={tbl.th}>Date</th>
                  <th className={tbl.thR}>Moisture</th>
                  <th className={tbl.th}>QC</th>
                </tr>
              </thead>
              <tbody>
                {line.lots.length === 0 && (
                  <tr>
                    <td colSpan={4} className={cx(tbl.td, "text-stone-500")}>
                      No lots yet.
                    </td>
                  </tr>
                )}
                {line.lots.map((l) => (
                  <tr key={l.lotNo} className={cx(tbl.tr, l.qc === "HOLD" && "bg-red-50/50")}>
                    <td className={cx(tbl.td, "font-mono text-[12px]")}>{l.lotNo}</td>
                    <td className={cx(tbl.td, "whitespace-nowrap text-stone-600")}>{new Date(`${l.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td>
                    <td className={cx(tbl.tdR, l.moisturePct != null && l.moisturePct > line.series[0].metric.high ? "font-semibold text-red-700" : "")}>{l.moisturePct != null ? `${l.moisturePct}%` : "–"}</td>
                    <td className={cx(tbl.td, "font-semibold", l.qc === "RELEASED" ? "text-emerald-700" : l.qc === "HOLD" ? "text-red-700" : "text-stone-500")}>{l.qc === "RELEASED" ? "Released" : l.qc === "HOLD" ? "On hold" : "Pending"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <p className="text-[12px] text-stone-500">Sample readings for the prototype. In production they come from the line&apos;s control system every few minutes; the prediction extends the last hour&apos;s trend to the band limit.</p>
    </div>
  );
}

// One reading over the shift: band shaded, line in ink, red where out of range.
function Chart({ s }: { s: Series }) {
  const W = 520;
  const H = 150;
  const pad = { l: 40, r: 8, t: 10, b: 22 };
  const vals = s.points.map((p) => p.v);
  const lo = Math.min(s.metric.low, ...vals);
  const hi = Math.max(s.metric.high, ...vals);
  const span = hi - lo || 1;
  const x = (i: number) => pad.l + (i / Math.max(1, s.points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo - span * 0.05) / (span * 1.1)) * (H - pad.t - pad.b);
  const d = s.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const tone = s.status === "out" ? "text-red-700" : s.status === "watch" ? "text-stone-900" : "text-emerald-700";
  return (
    <div className="border border-stone-300 bg-white">
      <div className="flex items-baseline justify-between border-b border-stone-200 px-3 py-2">
        <div>
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-700">{s.metric.label}</div>
          <div className="text-[11px] text-stone-500">
            Target {s.metric.low} to {s.metric.high} {s.metric.unit}
          </div>
        </div>
        <div className="text-right">
          <div className={cx("tabular text-[22px] font-medium leading-none tracking-[-0.03em]", tone)}>
            {s.now.toFixed(s.metric.decimals)}
            <span className="ml-1 text-[12px] font-normal text-stone-500">{s.metric.unit}</span>
          </div>
          <div className={cx("font-mono text-[10px] uppercase tracking-[0.12em]", tone)}>{s.status === "out" ? "Out of range" : s.status === "watch" ? "Near the limit" : "In range"}</div>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`${s.metric.label} over the shift`}>
        <rect x={pad.l} y={y(s.metric.high)} width={W - pad.l - pad.r} height={Math.max(0, y(s.metric.low) - y(s.metric.high))} fill="#f3f8f5" />
        <line x1={pad.l} x2={W - pad.r} y1={y(s.metric.high)} y2={y(s.metric.high)} stroke="#cfe5da" strokeDasharray="3 3" />
        <line x1={pad.l} x2={W - pad.r} y1={y(s.metric.low)} y2={y(s.metric.low)} stroke="#cfe5da" strokeDasharray="3 3" />
        <text x={pad.l - 4} y={y(s.metric.high) + 3} textAnchor="end" fontSize="9" fill="#5c6066" fontFamily="var(--font-code)">
          {s.metric.high}
        </text>
        <text x={pad.l - 4} y={y(s.metric.low) + 3} textAnchor="end" fontSize="9" fill="#5c6066" fontFamily="var(--font-code)">
          {s.metric.low}
        </text>
        <path d={d} fill="none" stroke={s.status === "out" ? "#c0392b" : "#0a0a0a"} strokeWidth="1.5" strokeLinejoin="round" />
        {s.points.map((p, i) => (p.v > s.metric.high || p.v < s.metric.low ? <circle key={i} cx={x(i)} cy={y(p.v)} r="2.2" fill="#c0392b" /> : null))}
        {s.points
          .filter((_, i) => i % 12 === 0)
          .map((p) => (
            <text key={p.t} x={x(s.points.indexOf(p))} y={H - 6} textAnchor="middle" fontSize="9" fill="#8a8f96" fontFamily="var(--font-code)">
              {p.t}
            </text>
          ))}
      </svg>
    </div>
  );
}
