import { PlanCalendar, type CalendarCell } from "@/components/plan-calendar";
import { CalendarViewSwitch, PlanningTabs, type PlanningTab } from "@/components/planning-tabs";
import { DailyBoard, NowRunning, type DailyLine, type DayLogView } from "@/components/daily-board";
import { LineQualityBoard, type LineQuality } from "@/components/line-quality";
import { TodayTasks, type Task } from "@/components/today-tasks";
import { WhatIf, type Sim, type WhatIfParams } from "@/components/what-if";
import { simulateBeanPrice, simulateCapacity, simulateLineStop } from "@/lib/simulate";
import { defaultAlerts, lineReadings } from "@/lib/quality";
import { ProductionLog, type MonthTally, type ProductionRow } from "@/components/production-log";
import { PlanSuggestions } from "@/components/plan-suggestions";
import { PageHeader, type StatItem } from "@/components/ui";
import { store } from "@/data/store";
import { capacityAt, changeoverAt, freeAt, loadAt, loadCapacityState, noteAt, planHorizon, reservedAt } from "@/lib/capacity";
import { can, productLabel, todayIso, addMonths, monthLabel, PRODUCT_TYPES } from "@/lib/domain";
import { inventoryProjection, shortages } from "@/lib/inventory";
import { requirementsFor } from "@/lib/procurement";
import { getViewer } from "@/lib/role";
import { lineMarginFor } from "@/lib/order-margin";
import { planSuggestions } from "@/lib/recommend";
import { loadSettings } from "@/lib/settings";
import { withShare } from "@/lib/workflow";

export default async function PlanPage({ searchParams }: PageProps<"/plan">) {
  const { tab, month: monthParam, ...simParams } = await searchParams;
  const active: PlanningTab = tab === "new" || tab === "done" || tab === "daily" || tab === "today" || tab === "quality" || tab === "whatif" ? tab : "calendar";
  const viewer = await getViewer();
  const suggestions = planSuggestions();
  const toPlace = suggestions.filter((x) => !x.keep).length;
  const st = store();
  const s = loadSettings();
  const state = loadCapacityState();
  const months = planHorizon(18);
  const projection = inventoryProjection(months);

  const cells: Record<string, CalendarCell> = {};
  for (const line of state.lines) {
    for (const m of months) {
      const rows = state.rows.filter((r) => r.lineId === line.id && r.month === m);
      const materials = new Map<
        string,
        {
          key: string;
          name: string;
          unit: string;
          need: number;
          monthShort: number;
        }
      >();
      for (const r of rows) {
        const a = st.allocations.find((x) => x.id === r.id)!;
        const order = st.orders.find((o) => o.id === r.orderId)!;
        const ol = st.orderLines.find((l) => l.id === r.orderLineId)!;
        const sku = withShare(
          st.skus.find((x) => x.id === ol.skuId)!,
          ol.chicoryPct,
        );
        for (const d of requirementsFor(sku, order, a, s)) {
          const e = materials.get(d.key) ?? {
            key: d.key,
            name: d.material,
            unit: d.unit,
            need: 0,
            monthShort: projection.find((p) => p.key === d.key)?.cells[m]?.short ?? 0,
          };
          e.need += d.quantity;
          materials.set(d.key, e);
        }
      }
      cells[`${line.id}|${m}`] = {
        capacity: capacityAt(state, line.id, m),
        used: loadAt(state, line.id, m),
        reserved: reservedAt(state, line.id, m),
        changeover: changeoverAt(state, line.id, m),
        note: noteAt(state, line.id, m),
        orders: rows.map((r) => {
          const ol = st.orderLines.find((l) => l.id === r.orderLineId)!;
          const sku = st.skus.find((x) => x.id === ol.skuId)!;
          return {
            allocationId: r.id,
            orderId: r.orderId,
            ref: r.orderRef,
            customer: r.customer,
            quantityMt: r.quantityMt,
            status: r.status,
            productType: r.productType,
            producedMt: st.allocations.find((x) => x.id === r.id)?.producedMt ?? null,
            marginPct:
              lineMarginFor(
                ol,
                st.orders.find((o) => o.id === r.orderId)!,
                s,
              )?.marginPct ?? null,
            product: productLabel(sku, ol.chicoryPct),
          };
        }),
        reservations: st.reservations
          .filter((x) => x.lineId === line.id && x.month === m)
          .map((x) => ({
            id: x.id,
            label: x.label,
            quantityMt: x.quantityMt,
            productType: x.productType,
          })),
        materials: [...materials.values()],
      };
    }
  }

  // Key numbers for the header: this month's load, room ahead, orders still to place, materials short.
  const sum = (f: (lineId: number, m: string) => number, ms: string[]) => Math.round(state.lines.reduce((a, l) => a + ms.reduce((b, m) => b + f(l.id, m), 0), 0));
  // The first month with something planned on it (the demo data starts a little ahead of today).
  const m0 = months.find((m) => sum((id, mm) => loadAt(state, id, mm), [m]) > 0) ?? months[0];
  const planned = sum((id, m) => loadAt(state, id, m), [m0]);
  const cap = sum((id, m) => capacityAt(state, id, m), [m0]);
  const free3 = sum((id, m) => Math.max(0, freeAt(state, id, m)), months.slice(0, 3));
  const shortCount = new Set(shortages(projection).map((x) => x.key)).size;
  const stats: StatItem[] = [
    { label: `Planned, ${monthLabel(m0, false)}`, value: `${planned} t`, hint: `of ${cap} t capacity on ${state.lines.length} lines` },
    { label: "Free, 3 months", value: `${free3} t`, hint: `Room left to sell, ${monthLabel(months[0], false)} to ${monthLabel(months[2], false)}` },
    { label: "Orders to place", value: toPlace, hint: toPlace ? "Waiting for a line" : "All placed" },
    { label: "Materials short", value: shortCount, hint: shortCount ? "See Inventory" : "Plan is covered", tone: shortCount ? "red" : "green" },
  ];

  return (
    <>
      <PageHeader eyebrow="02 / Production" title="Production" emph="calendar" subtitle="Four lines, month by month. Click a box to see its orders." stats={stats} />
      <PlanningTabs active={active} toPlace={toPlace} />
      {active === "new" && (
        <PlanSuggestions
          items={suggestions}
          canEdit={can(viewer.role, ["COO", "PLANNER"])}
          lines={state.lines.map((l) => ({ id: l.id, code: l.code, productTypes: l.productTypes }))}
          months={months}
          free={Object.fromEntries(state.lines.flatMap((l) => months.map((m) => [`${l.id}|${m}`, freeAt(state, l.id, m)])))}
        />
      )}
      {(active === "calendar" || active === "daily") && <CalendarViewSwitch view={active === "daily" ? "daily" : "monthly"} />}
      {active === "today" && <Today months={months} canEdit={can(viewer.role, ["COO", "PLANNER"])} />}
      {active === "quality" && <Quality months={months} />}
      {active === "whatif" && <WhatIfTab months={months} sp={simParams} />}
      {active === "daily" && <Daily months={months} monthParam={typeof monthParam === "string" ? monthParam : undefined} canEdit={can(viewer.role, ["COO", "PLANNER"])} />}
      {active === "done" && <ProductionDone months={months} monthParam={typeof monthParam === "string" ? monthParam : undefined} canEdit={can(viewer.role, ["COO", "PLANNER"])} />}
      {active === "calendar" && (
        <PlanCalendar
          months={months}
          lines={state.lines.map((l) => ({
            id: l.id,
            code: l.code,
            name: l.name,
            capacityMt: l.capacityMt,
            productTypes: l.productTypes,
          }))}
          cells={cells}
          canEdit={can(viewer.role, ["COO", "PLANNER"])}
          canRequest={can(viewer.role, ["COO", "PLANNER", "PROCUREMENT"])}
        />
      )}
    </>
  );
}

// Execution view: approved slots per month with what was actually made.
function ProductionDone({ months, monthParam, canEdit }: { months: string[]; monthParam?: string; canEdit: boolean }) {
  const st = store();
  const approved = new Set(st.orders.filter((o) => o.status === "COMMITTED").map((o) => o.id));
  const slots = st.allocations.filter((a) => approved.has(a.orderId));
  const shown = months.slice(0, 9);
  const firstBusy = shown.find((m) => slots.some((a) => a.month === m)) ?? shown[0];
  const month = monthParam && months.includes(monthParam) ? monthParam : firstBusy;
  const tallies: MonthTally[] = shown.map((m) => {
    const inMonth = slots.filter((a) => a.month === m);
    return { month: m, slots: inMonth.length, planned: inMonth.reduce((x, a) => x + a.quantityMt, 0), made: inMonth.reduce((x, a) => x + (a.producedMt ?? 0), 0), recorded: inMonth.filter((a) => a.producedMt != null).length };
  });
  const rows: ProductionRow[] = slots
    .filter((a) => a.month === month)
    .map((a) => {
      const order = st.orders.find((o) => o.id === a.orderId)!;
      const ol = st.orderLines.find((l) => l.id === a.orderLineId)!;
      const sku = st.skus.find((x) => x.id === ol.skuId)!;
      return {
        month: a.month,
        allocationId: a.id,
        orderId: order.id,
        customer: st.customers.find((c) => c.id === order.customerId)?.name ?? "",
        product: productLabel(sku, ol.chicoryPct),
        productType: sku.productType,
        line: st.lines.find((l) => l.id === a.lineId)?.code ?? "",
        planned: a.quantityMt,
        made: a.producedMt ?? null,
        note: a.productionNote ?? "",
      };
    })
    .sort((x, y) => x.line.localeCompare(y.line) || x.customer.localeCompare(y.customer));
  return <ProductionLog month={month} tallies={tallies} rows={rows} canEdit={canEdit} />;
}

// Daily calendar for one month: working days, per-line day capacity, and the day logs.
function Daily({ months, monthParam, canEdit }: { months: string[]; monthParam?: string; canEdit: boolean }) {
  const st = store();
  const state = loadCapacityState();
  const approved = new Set(st.orders.filter((o) => o.status === "COMMITTED").map((o) => o.id));
  const shown = months.slice(0, 9);
  const firstBusy = shown.find((m) => st.allocations.some((a) => approved.has(a.orderId) && a.month === m)) ?? shown[0];
  const month = monthParam && months.includes(monthParam) ? monthParam : firstBusy;
  const [y, mo] = month.split("-").map(Number);
  const days = Array.from({ length: new Date(y, mo, 0).getDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);

  const lines: DailyLine[] = state.lines.map((l) => {
    const cap = capacityAt(state, l.id, month);
    return {
      id: l.id,
      code: l.code,
      monthCapacity: cap,
      runDays: l.runDays ?? [1, 2, 3, 4, 5, 6],
      dayCapacity: Math.round((cap / Math.max(1, days.filter((d) => (l.runDays ?? [1, 2, 3, 4, 5, 6]).includes(new Date(`${d}T00:00:00`).getDay())).length)) * 10) / 10,
      slots: st.allocations
        .filter((a) => approved.has(a.orderId) && a.lineId === l.id && a.month === month)
        .map((a) => {
          const ol = st.orderLines.find((x) => x.id === a.orderLineId)!;
          const sku = st.skus.find((x) => x.id === ol.skuId)!;
          return {
            allocationId: a.id,
            orderId: a.orderId,
            ref: st.orders.find((o) => o.id === a.orderId)?.ref ?? "",
            customer: st.customers.find((c) => c.id === st.orders.find((o) => o.id === a.orderId)?.customerId)?.name ?? "",
            product: productLabel(sku, ol.chicoryPct),
            productType: sku.productType,
            blend: sku.blend,
            planned: a.quantityMt,
            made: a.producedMt ?? 0,
          };
        }),
    };
  });
  const logs: Record<string, DayLogView> = {};
  for (const d of st.dayLogs.filter((x) => x.date.startsWith(month))) {
    logs[`${d.lineId}|${d.date}`] = {
      id: d.id,
      allocationId: d.allocationId,
      capacityT: d.capacityT,
      lockedAt: d.lockedAt.toISOString(),
      lockedBy: d.lockedBy,
      events: d.events.map((e) => ({ ...e, at: e.at.toISOString() })),
      madeT: d.madeT,
      closed: !!d.closedAt,
      stopped: !!d.stopped,
      batches: (d.batches ?? []).map((b) => ({ ...b })),
    };
  }
  const set = loadSettings();
  const changeoverHours = Object.fromEntries(
    Object.keys(set)
      .filter((k) => k.startsWith("changeover."))
      .map((k) => [k.replace("changeover.", ""), set[k]]),
  );
  return <DailyBoard month={month} months={shown} days={days} lines={lines} logs={logs} canEdit={canEdit} changeoverHours={changeoverHours} todayIso={todayIso()} />;
}

// Shared: the daily lines + logs for one month, used by Today and Line quality.
function dailyData(month: string) {
  const st = store();
  const state = loadCapacityState();
  const approved = new Set(st.orders.filter((o) => o.status === "COMMITTED").map((o) => o.id));
  const [y, mo] = month.split("-").map(Number);
  const days = Array.from({ length: new Date(y, mo, 0).getDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const lines: DailyLine[] = state.lines.map((l) => {
    const cap = capacityAt(state, l.id, month);
    const runDays = l.runDays ?? [1, 2, 3, 4, 5, 6];
    return {
      id: l.id,
      code: l.code,
      monthCapacity: cap,
      runDays,
      dayCapacity: Math.round((cap / Math.max(1, days.filter((d) => runDays.includes(new Date(`${d}T00:00:00`).getDay())).length)) * 10) / 10,
      slots: st.allocations
        .filter((a) => approved.has(a.orderId) && a.lineId === l.id && a.month === month)
        .map((a) => {
          const ol = st.orderLines.find((x) => x.id === a.orderLineId)!;
          const sku = st.skus.find((x) => x.id === ol.skuId)!;
          const order = st.orders.find((o) => o.id === a.orderId)!;
          return {
            allocationId: a.id,
            orderId: a.orderId,
            ref: order.ref,
            customer: st.customers.find((c) => c.id === order.customerId)?.name ?? "",
            product: productLabel(sku, ol.chicoryPct),
            productType: sku.productType,
            blend: sku.blend,
            planned: a.quantityMt,
            made: a.producedMt ?? 0,
          };
        }),
    };
  });
  const logs: Record<string, DayLogView> = {};
  for (const d of st.dayLogs.filter((x) => x.date.startsWith(month))) {
    logs[`${d.lineId}|${d.date}`] = {
      id: d.id,
      allocationId: d.allocationId,
      capacityT: d.capacityT,
      lockedAt: d.lockedAt.toISOString(),
      lockedBy: d.lockedBy,
      events: d.events.map((e) => ({ ...e, at: e.at.toISOString() })),
      madeT: d.madeT,
      closed: !!d.closedAt,
      stopped: !!d.stopped,
      batches: (d.batches ?? []).map((b) => ({ ...b })),
    };
  }
  return { st, days, lines, logs };
}

// The planner's day: what is running now and what needs doing, built from the live data.
function Today({ months, canEdit }: { months: string[]; canEdit: boolean }) {
  const today = todayIso();
  // The sample data's running day stands in for "today" so the demo always has something live.
  const st = store();
  const openLog = st.dayLogs.find((d) => !d.closedAt && !d.stopped);
  const focus = openLog?.date ?? today;
  const month = focus.slice(0, 7);
  const { days, lines, logs } = dailyData(month);
  const tasks: Task[] = [];

  for (const l of lines) {
    const log = logs[`${l.id}|${focus}`];
    const runsToday = l.runDays.includes(new Date(`${focus}T00:00:00`).getDay());
    const hasWork = l.slots.some((s) => s.made < s.planned - 0.05);
    if (!log && runsToday && hasWork)
      tasks.push({ kind: "start", title: `Start ${l.code}`, detail: `${l.slots.find((s) => s.made < s.planned - 0.05)?.customer}, ${l.dayCapacity} t planned today`, href: `/plan?tab=daily&month=${month}`, action: "Lock and start", urgent: true });
  }
  for (const d of st.dayLogs.filter((d) => !d.closedAt && !d.stopped && d.date < focus)) {
    const line = st.lines.find((l) => l.id === d.lineId)?.code ?? "";
    tasks.push({
      kind: "close",
      title: `Close ${line} for ${new Date(`${d.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
      detail: "Locked but never closed. Enter the tonnes made.",
      href: `/plan?tab=daily&month=${d.date.slice(0, 7)}`,
      action: "Close the day",
      urgent: true,
    });
  }
  const pendingQc = st.dayLogs.flatMap((d) => (d.batches ?? []).filter((b) => b.qc !== "RELEASED").map((b) => ({ ...b, line: st.lines.find((l) => l.id === d.lineId)?.code ?? "", month: d.date.slice(0, 7) })));
  const held = pendingQc.filter((b) => b.qc === "HOLD");
  const pend = pendingQc.filter((b) => b.qc === "PENDING");
  if (held.length)
    tasks.push({
      kind: "qc",
      title: `${held.length} lot${held.length > 1 ? "s" : ""} on QC hold`,
      detail: held.map((b) => `${b.lotNo}${b.note ? ` (${b.note})` : ""}`).join(", "),
      href: `/plan?tab=daily&month=${held[0].month}`,
      action: "Decide",
      urgent: true,
    });
  if (pend.length) tasks.push({ kind: "qc", title: `${pend.length} lot${pend.length > 1 ? "s" : ""} waiting for QC release`, detail: pend.map((b) => b.lotNo).join(", "), href: `/plan?tab=daily&month=${pend[0].month}`, action: "Release" });

  const toPlace = planSuggestions().filter((x) => !x.keep);
  if (toPlace.length)
    tasks.push({
      kind: "place",
      title: `Place ${toPlace.length} new order slot${toPlace.length > 1 ? "s" : ""}`,
      detail:
        toPlace
          .slice(0, 3)
          .map((x) => x.customer)
          .join(", ") + (toPlace.length > 3 ? "…" : ""),
      href: "/plan?tab=new",
      action: "Allocate",
    });

  const carry = st.allocations.filter((a) => a.month < month && a.producedMt != null && a.producedMt < a.quantityMt - 0.05 && st.orders.find((o) => o.id === a.orderId)?.status === "COMMITTED");
  if (carry.length)
    tasks.push({
      kind: "carry",
      title: `${carry.length} short slot${carry.length > 1 ? "s" : ""} from earlier months`,
      detail: `${carry.reduce((a, x) => a + (x.quantityMt - (x.producedMt ?? 0)), 0).toFixed(1)} t not made yet, move it to a later month`,
      href: "/plan?tab=done",
      action: "Move",
    });

  const limit = addMonths(month, 2);
  const shorts = shortages().filter((x) => x.month <= limit && !st.purchaseRequests.some((r) => r.status === "OPEN" && r.materialKey === x.key));
  if (shorts.length)
    tasks.push({
      kind: "buy",
      title: `${shorts.length} material${shorts.length > 1 ? "s" : ""} short in the next 3 months`,
      detail: [...new Set(shorts.map((x) => x.name.replace("Green beans · ", "Beans · ")))].slice(0, 3).join(", "),
      href: "/procurement",
      action: "Ask procurement",
    });

  const q = lines.map((l) => ({ code: l.code, out: lineReadings(l.code, focus, undefined, l.code === "SD01").filter((s) => s.status === "out").length })).filter((x) => x.out > 0);
  if (q.length) tasks.push({ kind: "quality", title: `Readings out of range on ${q.map((x) => x.code).join(", ")}`, detail: "Check the line before the lot is affected", href: "/plan?tab=quality", action: "See readings", urgent: true });

  const order = { start: 0, close: 1, qc: 2, quality: 3, place: 4, carry: 5, buy: 6 };
  tasks.sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || order[a.kind] - order[b.kind]);

  return (
    <div className="space-y-6">
      <TodayTasks tasks={canEdit ? tasks : tasks.filter((t) => t.kind !== "start" && t.kind !== "close")} />
      <NowRunning lines={lines} logs={logs} days={days} todayIso={focus} month={month} />
      {months.length === 0 && null}
    </div>
  );
}

// Live readings per line against target bands, with alerts and recent lot results.
function Quality({ months }: { months: string[] }) {
  const st = store();
  const openLog = st.dayLogs.find((d) => !d.closedAt && !d.stopped);
  const focus = openLog?.date ?? todayIso();
  const { lines, logs } = dailyData(focus.slice(0, 7));
  const data: LineQuality[] = lines.map((l) => {
    const log = logs[`${l.id}|${focus}`];
    const running = log && !log.closed && !log.stopped ? (l.slots.find((s) => s.allocationId === log.allocationId)?.customer ?? "an order") : null;
    const lots = st.dayLogs
      .filter((d) => d.lineId === l.id)
      .flatMap((d) => (d.batches ?? []).map((b) => ({ lotNo: b.lotNo, moisturePct: b.moisturePct, qc: b.qc, date: d.date })))
      .sort((a, b) => b.lotNo.localeCompare(a.lotNo))
      .slice(0, 6);
    return { code: l.code, running: running ? `${running} · ${l.slots.find((s) => s.allocationId === log?.allocationId)?.product ?? ""}` : null, series: lineReadings(l.code, focus, undefined, l.code === "SD01"), alerts: defaultAlerts(l.code), lots };
  });
  return (
    <>
      <LineQualityBoard lines={data} />
      {months.length === 0 && null}
    </>
  );
}

// What-if scenarios: inputs come from the query string so the page stays a plain server render.
function WhatIfTab({ months, sp }: { months: string[]; sp: Record<string, string | string[] | undefined> }) {
  const state = loadCapacityState();
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const sim: Sim = str("sim") === "bean" || str("sim") === "capacity" ? (str("sim") as Sim) : "line";
  const lines = state.lines.map((l) => ({ id: l.id, code: l.code, productTypes: l.productTypes }));
  // Defaults that show something on first open: the busiest line and month, a 15% bean rise, 10 t more on the fullest line.
  const busiest = state.rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [`${r.lineId}|${r.month}`]: (acc[`${r.lineId}|${r.month}`] ?? 0) + r.quantityMt }), {});
  const top = Object.entries(busiest)
    .sort((a, b) => b[1] - a[1])[0]?.[0]
    ?.split("|");
  const lineId = Number(str("line")) || (top ? Number(top[0]) : lines[0]?.id);
  const month = months.includes(str("month")) ? str("month") : (top?.[1] ?? months[0]);
  const pct = str("pct") === "" ? 15 : Number(str("pct")) || 0;
  const line = lines.find((l) => l.id === lineId) ?? lines[0];
  const productType = str("product") in PRODUCT_TYPES ? str("product") : (line?.productTypes[0] ?? "SD");
  const extraMt = Math.max(1, Number(str("extra")) || 10);
  const params: WhatIfParams = { sim, lineId: line?.id ?? 0, month, pct, productType, extraMt };
  const result = sim === "line" ? simulateLineStop(params.lineId, month) : sim === "bean" ? simulateBeanPrice(pct) : simulateCapacity(params.lineId, productType, extraMt);
  return <WhatIf params={params} months={months} lines={lines} result={result} />;
}
