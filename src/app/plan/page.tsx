import { PlanCalendar, type CalendarCell } from "@/components/plan-calendar";
import { CalendarViewSwitch, PlanningTabs, type PlanningTab } from "@/components/planning-tabs";
import { DailyBoard, type DailyLine, type DayLogView } from "@/components/daily-board";
import { ProductionLog, type MonthTally, type ProductionRow } from "@/components/production-log";
import { PlanSuggestions } from "@/components/plan-suggestions";
import { PageHeader } from "@/components/ui";
import { store } from "@/data/store";
import { capacityAt, freeAt, loadAt, loadCapacityState, noteAt, planHorizon, reservedAt } from "@/lib/capacity";
import { can, productLabel } from "@/lib/domain";
import { inventoryProjection } from "@/lib/inventory";
import { requirementsFor } from "@/lib/procurement";
import { getViewer } from "@/lib/role";
import { lineMarginFor } from "@/lib/order-margin";
import { planSuggestions } from "@/lib/recommend";
import { loadSettings } from "@/lib/settings";
import { withShare } from "@/lib/workflow";

export default async function PlanPage({ searchParams }: PageProps<"/plan">) {
  const { tab, month: monthParam } = await searchParams;
  const active: PlanningTab = tab === "new" || tab === "done" || tab === "daily" ? tab : "calendar";
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

  return (
    <>
      <PageHeader eyebrow="02 / Production" title="Production" emph="calendar" subtitle="Three lines, month by month. Click a box to see its orders." />
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
            customer: st.customers.find((c) => c.id === st.orders.find((o) => o.id === a.orderId)?.customerId)?.name ?? "",
            product: productLabel(sku, ol.chicoryPct),
            productType: sku.productType,
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
    };
  }
  return <DailyBoard month={month} months={shown} days={days} lines={lines} logs={logs} canEdit={canEdit} />;
}
