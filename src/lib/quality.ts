// Line quality readings for the demo: deterministic sample data per line and day, shaped like a
// real spray-dryer / freeze-dryer feed (moisture, outlet temperature, feed rate, bulk density).
// In production these come from the line's PLC or lab system every few minutes.

export type Metric = { key: string; label: string; unit: string; low: number; high: number; decimals: number };
export type Series = { metric: Metric; points: { t: string; v: number }[]; now: number; status: "ok" | "watch" | "out"; prediction: string | null };
export type Alert = { metric: string; when: string; note: string; active: boolean };

const METRICS: Record<string, Metric[]> = {
  SD: [
    { key: "moisture", label: "Powder moisture", unit: "%", low: 2.5, high: 4.5, decimals: 1 },
    { key: "outlet", label: "Dryer outlet temp", unit: "°C", low: 95, high: 110, decimals: 0 },
    { key: "feed", label: "Feed rate", unit: "kg/h", low: 60, high: 80, decimals: 0 },
    { key: "density", label: "Bulk density", unit: "g/l", low: 200, high: 260, decimals: 0 },
  ],
  FDC: [
    { key: "moisture", label: "Granule moisture", unit: "%", low: 1.5, high: 3.0, decimals: 1 },
    { key: "chamber", label: "Chamber pressure", unit: "mbar", low: 0.3, high: 0.8, decimals: 2 },
    { key: "shelf", label: "Shelf temp", unit: "°C", low: 40, high: 55, decimals: 0 },
    { key: "density", label: "Bulk density", unit: "g/l", low: 220, high: 280, decimals: 0 },
  ],
};

// Small deterministic generator so the same line and day always show the same curve.
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const slot = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function lineReadings(lineCode: string, date: string, upToMinute = 14 * 60 + 20, drift = false): Series[] {
  const metrics = METRICS[lineCode.startsWith("FDC") ? "FDC" : "SD"];
  const rand = rng(`${lineCode}|${date}`);
  const start = 7 * 60;
  return metrics.map((metric) => {
    const mid = (metric.low + metric.high) / 2;
    const band = metric.high - metric.low;
    let v = mid + (rand() - 0.5) * band * 0.3;
    const points: { t: string; v: number }[] = [];
    for (let m = start; m <= upToMinute; m += 10) {
      // One line drifts upward in moisture through the afternoon (no pull back to the middle), to show a prediction.
      const drifting = drift && metric.key === "moisture" && m > 11 * 60;
      v += (rand() - 0.5) * band * (drifting ? 0.04 : 0.08) + (drifting ? band * 0.014 : (mid - v) * 0.05);
      points.push({ t: slot(m), v: Number(v.toFixed(metric.decimals + 1)) });
    }
    const now = points.at(-1)!.v;
    const status: Series["status"] = now < metric.low || now > metric.high ? "out" : now < metric.low + band * 0.15 || now > metric.high - band * 0.15 ? "watch" : "ok";
    return { metric, points, now, status, prediction: predict(points, metric, upToMinute) };
  });
}

// Trend over the last hour, projected forward: when does it cross the band?
function predict(points: { t: string; v: number }[], metric: Metric, nowMin: number): string | null {
  const recent = points.slice(-6);
  if (recent.length < 4) return null;
  const slopePer10 = (recent.at(-1)!.v - recent[0].v) / (recent.length - 1);
  const now = recent.at(-1)!.v;
  if (Math.abs(slopePer10) < (metric.high - metric.low) * 0.004) return null;
  const limit = slopePer10 > 0 ? metric.high : metric.low;
  const steps = (limit - now) / slopePer10;
  if (steps <= 0) return `${metric.label} is already ${slopePer10 > 0 ? "above" : "below"} its band.`;
  if (steps > 24) return null;
  const at = slot(Math.round(nowMin + steps * 10));
  const fix =
    metric.key === "moisture"
      ? slopePer10 > 0
        ? "Lower the feed rate a little or raise the outlet temperature."
        : "Feed can go up a little."
      : metric.key === "outlet"
        ? slopePer10 > 0
          ? "Ease the burner or raise the feed."
          : "Raise the burner a little."
        : "Check the line before then.";
  return `At this trend, ${metric.label.toLowerCase()} reaches ${limit}${metric.unit} at about ${at}. ${fix}`;
}

export function defaultAlerts(lineCode: string): Alert[] {
  const metrics = METRICS[lineCode.startsWith("FDC") ? "FDC" : "SD"];
  return metrics.flatMap((m) => [
    { metric: m.label, when: `above ${m.high}${m.unit}`, note: "Out of range", active: true },
    { metric: m.label, when: `below ${m.low}${m.unit}`, note: "Out of range", active: m.key === "moisture" || m.key === "density" },
  ]);
}
