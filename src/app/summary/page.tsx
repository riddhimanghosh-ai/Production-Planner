import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { Card, cx, Empty, PageHeader, Stat, StatStrip } from "@/components/ui";
import { capacityAt, loadCapacityState, planHorizon } from "@/lib/capacity";
import { can, formatInr, formatMt, monthLabel } from "@/lib/domain";
import { approvalQueue, listOrderViews } from "@/lib/queries";
import { getViewer } from "@/lib/role";

// Optional module: kept in the menu but switched off for this prototype.
const LOCKED = true;

export default async function SummaryPage({ searchParams }: PageProps<"/summary">) {
  if (LOCKED) {
    return (
      <>
        <PageHeader title="Leadership summary" />
        <Empty>Optional, not switched on in this prototype.</Empty>
      </>
    );
  }
  const viewer = await getViewer();
  if (!can(viewer.role, ["CEO", "CFO", "COO", "BD_HEAD", "ADMIN"])) {
    return (
      <>
        <PageHeader title="Leadership summary" />
        <Empty>The leadership summary is for the CEO, CFO, COO and sales head. Switch the &ldquo;Viewing as&rdquo; user to see it.</Empty>
      </>
    );
  }
  const sp = await searchParams;
  const horizon = planHorizon(15);
  const from = typeof sp.from === "string" && horizon.includes(sp.from) ? sp.from : horizon[0];
  const to = typeof sp.to === "string" && horizon.includes(sp.to) ? sp.to : horizon[11];
  const months = horizon.filter((m) => m >= from && m <= to);

  const state = loadCapacityState();
  const util = months.map((m) => {
    const capacity = state.lines.reduce((a, l) => a + capacityAt(state, l.id, m), 0);
    const approved = state.rows.filter((r) => r.month === m && r.status === "COMMITTED").reduce((a, r) => a + r.quantityMt, 0);
    const pending = state.rows.filter((r) => r.month === m && r.status !== "COMMITTED").reduce((a, r) => a + r.quantityMt, 0);
    return { m, capacity, approved, pending, pct: capacity ? ((approved + pending) / capacity) * 100 : 0 };
  });

  const views = listOrderViews(viewer).filter((v) => v.order.status === "COMMITTED" || v.order.status === "PENDING_APPROVAL" || v.order.status === "SENT_BACK");
  const inRange = views.flatMap((v) => v.lines.filter((l) => months.includes(l.month)).map((l) => ({ v, l })));

  const byProduct = new Map<string, { name: string; approvedMt: number; pendingMt: number; revenue: number; margin: number }>();
  const byCustomer = new Map<number, { name: string; mt: number; revenue: number; margin: number; orders: Set<number> }>();
  for (const { v, l } of inRange) {
    const firm = v.order.status === "COMMITTED";
    const p = byProduct.get(l.sku.code) ?? { name: l.sku.name, approvedMt: 0, pendingMt: 0, revenue: 0, margin: 0 };
    if (firm) {
      p.approvedMt += l.quantityMt;
      p.revenue += l.margin?.revenue ?? 0;
      p.margin += l.margin?.totalMargin ?? 0;
    } else p.pendingMt += l.quantityMt;
    byProduct.set(l.sku.code, p);
    const c = byCustomer.get(v.customer.id) ?? { name: v.customer.name, mt: 0, revenue: 0, margin: 0, orders: new Set<number>() };
    c.mt += l.quantityMt;
    c.revenue += l.margin?.revenue ?? 0;
    c.margin += l.margin?.totalMargin ?? 0;
    c.orders.add(v.order.id);
    byCustomer.set(v.customer.id, c);
  }
  const products = [...byProduct.entries()].sort((a, b) => b[1].approvedMt + b[1].pendingMt - (a[1].approvedMt + a[1].pendingMt));
  const customers = [...byCustomer.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);

  const queue = approvalQueue(viewer);
  const backlogValue = queue.reduce((a, q) => a + q.margin.revenue, 0);
  const oldest = queue.reduce((a, q) => Math.max(a, q.daysPending), 0);
  const waitingCfo = queue.filter((q) => q.waitingOn.includes("CFO")).length;
  const waitingCoo = queue.filter((q) => q.waitingOn.includes("COO")).length;

  const totalCap = util.reduce((a, u) => a + u.capacity, 0);
  const totalApproved = util.reduce((a, u) => a + u.approved, 0);
  const totalPending = util.reduce((a, u) => a + u.pending, 0);
  const totalRevenue = products.reduce((a, [, p]) => a + p.revenue, 0);
  const totalMargin = products.reduce((a, [, p]) => a + p.margin, 0);
  const sel = "rounded-sm border border-stone-300 bg-white px-2.5 py-1.5 text-sm";

  return (
    <>
      <PageHeader
        title="Leadership summary"
        subtitle={`${monthLabel(from)} – ${monthLabel(to)} · utilisation, booked volume and margin, top customers and the approval backlog`}
        actions={
          <form className="flex items-center gap-2">
            <select name="from" defaultValue={from} className={sel} aria-label="From month">
              {horizon.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
            <span className="text-sm text-stone-500">to</span>
            <select name="to" defaultValue={to} className={sel} aria-label="To month">
              {horizon.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
            <button className="rounded-sm bg-stone-900 px-3 py-1.5 text-sm font-medium text-white">Apply</button>
          </form>
        }
      />

      <StatStrip>
        <Stat label="Utilisation" value={`${totalCap ? Math.round(((totalApproved + totalPending) / totalCap) * 100) : 0}%`} hint={`${formatMt(totalApproved)} approved + ${formatMt(totalPending)} pending of ${formatMt(totalCap)}`} />
        <Stat label="Approved revenue" value={formatInr(totalRevenue)} />
        <Stat label="Approved margin" value={formatInr(totalMargin)} hint={totalRevenue ? `${((totalMargin / totalRevenue) * 100).toFixed(1)}% blended` : undefined} />
        <Stat label="Approval backlog" value={queue.length} hint={`${formatInr(backlogValue)} · ${waitingCfo} on CFO · ${waitingCoo} on COO`} tone={queue.length ? "amber" : "green"} />
        <Stat label="Oldest waiting" value={`${oldest} days`} tone={oldest >= 3 ? "red" : undefined} />
      </StatStrip>

      <Card
        className="mt-6"
        title="Utilisation by month"
        actions={<ExportButton filename="sln-utilisation" rows={[["Month", "Capacity (MT)", "Approved (MT)", "Pending (MT)", "Utilisation %"], ...util.map((u) => [monthLabel(u.m), u.capacity, u.approved.toFixed(1), u.pending.toFixed(1), u.pct.toFixed(0)])]} />}
      >
        <div className="flex h-44 items-end gap-2">
          {util.map((u) => (
            <div key={u.m} className="group relative flex h-full flex-1 flex-col items-center justify-end" title={`${monthLabel(u.m)}: ${u.approved.toFixed(0)} approved + ${u.pending.toFixed(0)} pending of ${u.capacity} MT`}>
              <span className={cx("mb-1 text-[11px] font-semibold", u.pct > 100 ? "text-red-700" : "text-stone-700")}>{Math.round(u.pct)}%</span>
              <div className="relative flex w-full max-w-10 flex-col-reverse gap-[2px]" style={{ height: `${Math.min(u.pct, 130) * 0.9}%` }}>
                <div className="w-full rounded-[4px] bg-brand-600" style={{ height: `${u.approved + u.pending ? (u.approved / (u.approved + u.pending)) * 100 : 0}%` }} />
                {u.pending > 0 && <div className="w-full flex-1 rounded-[4px]" style={{ background: "repeating-linear-gradient(135deg, #dcc4aa 0 4px, #efe3d6 4px 7px)" }} />}
              </div>
              <span className="mt-1 text-[11px] text-stone-500">{monthLabel(u.m)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-4 text-xs text-stone-600">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-[4px] bg-brand-600" /> Approved
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-[4px]" style={{ background: "repeating-linear-gradient(135deg, #dcc4aa 0 4px, #efe3d6 4px 7px)" }} /> Pending (soft hold)
          </span>
          <span>100% = total capacity across lines that month</span>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card
          title="Booked MT and margin by product"
          actions={
            <ExportButton
              filename="sln-by-product"
              rows={[["Product", "Approved MT", "Pending MT", "Approved revenue", "Approved margin", "Margin %"], ...products.map(([code, p]) => [code, p.approvedMt.toFixed(1), p.pendingMt.toFixed(1), Math.round(p.revenue), Math.round(p.margin), p.revenue ? ((p.margin / p.revenue) * 100).toFixed(1) : ""])]}
            />
          }
        >
          <table className="tabular w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 text-xs text-stone-500">
                <th className="py-2 text-left font-medium">Product</th>
                <th className="py-2 text-right font-medium">Approved</th>
                <th className="py-2 text-right font-medium">Pending</th>
                <th className="py-2 text-right font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {products.map(([code, p]) => (
                <tr key={code} className="border-b border-stone-50 last:border-0">
                  <td className="py-2">
                    <div className="font-medium">{code}</div>
                    <div className="text-xs text-stone-500">{p.name}</div>
                  </td>
                  <td className="py-2 text-right">{formatMt(p.approvedMt)}</td>
                  <td className="py-2 text-right text-stone-500">{p.pendingMt ? formatMt(p.pendingMt) : "–"}</td>
                  <td className="py-2 text-right">
                    {p.revenue ? (
                      <>
                        {formatInr(p.margin)} <span className="text-xs text-stone-500">({((p.margin / p.revenue) * 100).toFixed(1)}%)</span>
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card
          title="Top customers"
          actions={<ExportButton filename="sln-top-customers" rows={[["Customer", "Orders", "MT", "Value (INR)", "Margin (INR)"], ...customers.map((c) => [c.name, c.orders.size, c.mt.toFixed(1), Math.round(c.revenue), Math.round(c.margin)])]} />}
        >
          <table className="tabular w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 text-xs text-stone-500">
                <th className="py-2 text-left font-medium">Customer</th>
                <th className="py-2 text-right font-medium">Volume</th>
                <th className="py-2 text-right font-medium">Value</th>
                <th className="py-2 text-right font-medium">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.name} className="border-b border-stone-50 last:border-0">
                  <td className="py-2 font-medium">{c.name}</td>
                  <td className="py-2 text-right">{formatMt(c.mt)}</td>
                  <td className="py-2 text-right">{formatInr(c.revenue)}</td>
                  <td className="py-2 text-right">{c.revenue ? `${((c.margin / c.revenue) * 100).toFixed(1)}%` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-stone-500">Approved, submitted and sent-back orders with lines in the selected months.</p>
        </Card>
      </div>

      <Card className="mt-6" title="Approval backlog">
        {queue.length === 0 ? (
          <Empty>No orders waiting.</Empty>
        ) : (
          <table className="tabular w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 text-xs text-stone-500">
                <th className="py-2 text-left font-medium">Order</th>
                <th className="py-2 text-left font-medium">BD owner</th>
                <th className="py-2 text-left font-medium">Waiting on</th>
                <th className="py-2 text-right font-medium">Value</th>
                <th className="py-2 text-right font-medium">Days pending</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((q) => (
                <tr key={q.order.id} className="border-b border-stone-50 last:border-0">
                  <td className="py-2">
                    <Link href={`/orders/${q.order.id}`} className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
                      {q.order.ref}
                    </Link>{" "}
                    <span className="text-stone-600">{q.customer.name}</span>
                  </td>
                  <td className="py-2">{q.owner?.name}</td>
                  <td className="py-2">{q.waitingOn.join(" + ")}</td>
                  <td className="py-2 text-right">{formatInr(q.margin.revenue)}</td>
                  <td className={cx("py-2 text-right", q.daysPending >= 3 && "font-semibold text-red-700")}>{q.daysPending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
