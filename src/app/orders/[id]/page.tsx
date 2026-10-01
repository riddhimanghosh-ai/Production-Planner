import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelOrderButton, DecisionForm, GbClosureForm, ReassignForm } from "@/components/approval-actions";
import { Badge, ButtonLink, cx, StatusBadge, Tabs, tbl } from "@/components/ui";
import { capacityAt, loadAt, loadCapacityState } from "@/lib/capacity";
import { can, formatDate, formatInr, formatPerKg, FREIGHT_BASIS, monthLabel, ORIGINS, productLabel, type Origin, containerSummary } from "@/lib/domain";
import { shortages } from "@/lib/inventory";
import { bdUsers, getOrderView } from "@/lib/queries";
import { getViewer } from "@/lib/role";
import { loadSettings } from "@/lib/settings";
import { canEditOrder } from "@/lib/workflow";

export default async function OrderPage({ params, searchParams }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const { tab = "plan" } = await searchParams;
  const viewer = await getViewer();
  const data = getOrderView(Number(id), viewer);
  if (!data) notFound();
  const { order, customer, owner, lines, approvals, margin, revisions, log, allocations, commercials } = data;
  const s = loadSettings();
  const state = loadCapacityState();
  const editable = canEditOrder(viewer, order);
  const signable = order.status === "PENDING_APPROVAL" ? approvals.filter((a) => a.status === "PENDING" && can(viewer.role, [a.role as "CFO" | "COO"])).map((a) => a.role) : [];
  const shorts = shortages().filter((x) => x.orders.some((o) => o.orderId === order.id));
  const sku = lines[0]?.sku;
  const productName = sku ? productLabel(sku, lines[0].chicoryPct) : "–";
  const cur = order.currency === "USD" ? "$" : "₹";
  const approvalOf = (role: string) => approvals.find((a) => a.role === role);
  const slots = allocations.length ? allocations : lines.map((l) => ({ id: l.id, orderLineId: l.id, lineId: l.lineId, month: l.month, quantityMt: l.quantityMt, lineCode: l.lineCode }));
  const over = slots.filter((a) => loadAt(state, a.lineId, a.month) > capacityAt(state, a.lineId, a.month) + 0.05);
  const sentBack = approvals.filter((a) => a.status === "SENT_BACK");

  const tabs = [{ key: "plan", label: "Production plan" }, { key: "details", label: "Details" }, ...(commercials && lines[0]?.margin ? [{ key: "costs", label: "Costs" }] : []), { key: "history", label: "History", count: 0 }];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/orders" className="text-[13px] text-stone-500 hover:text-stone-800">
            Orders /
          </Link>
          <h1 className="text-lg font-semibold text-stone-900">{customer.name}</h1>
          <span className="text-[13px] text-stone-500">{order.ref}</span>
          <StatusBadge status={order.status} />
          {order.priority === "HIGH" && <Badge tone="red">High priority</Badge>}
        </div>
        {editable && (
          <div className="flex gap-2">
            <ButtonLink href={`/orders/${order.id}/edit`} variant={order.status === "SENT_BACK" || order.status === "DRAFT" ? "primary" : "secondary"}>
              {order.status === "SENT_BACK" ? "Fix & send again" : order.status === "DRAFT" ? "Continue & send" : "Edit"}
            </ButtonLink>
            <CancelOrderButton orderId={order.id} />
          </div>
        )}
      </div>

      <div className="mb-3 overflow-x-auto rounded-md border border-stone-300 bg-white">
        <table className="tabular w-full text-[13px]">
          <thead>
            <tr>
              <th className={tbl.th}>Product</th>
              <th className={tbl.th}>Shipments</th>
              <th className={tbl.thR}>Tonnes</th>
              <th className={tbl.thR}>Value</th>
              <th className={tbl.thR}>Profit</th>
              <th className={tbl.th}>Salesperson</th>
              <th className={tbl.th}>CFO</th>
              <th className={tbl.th}>COO</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={tbl.td}>{productName}</td>
              <td className={tbl.td}>
                <div className="font-medium">{containerSummary(order.shipments)}</div>
                <div className="text-[11px] text-stone-500">
                  {order.shipments?.length ? order.shipments.map((x) => `${x.containers} × ${x.size} ft ${monthLabel(x.month)}`).join(" · ") : `${monthLabel(data.firstMonth)} – ${monthLabel(data.lastMonth)}`}
                </div>
              </td>
              <td className={tbl.tdR}>{data.totalMt.toLocaleString("en-IN")}</td>
              <td className={tbl.tdR}>{commercials ? formatInr(margin.revenue) : "–"}</td>
              <td className={cx(tbl.tdR, "font-semibold", commercials && (margin.marginPct >= margin.targetPct ? "text-emerald-700" : "text-red-700"))}>{commercials ? `${margin.marginPct.toFixed(1)}%` : "–"}</td>
              <td className={tbl.td}>{owner?.name}</td>
              {(["CFO", "COO"] as const).map((r) => {
                const a = approvalOf(r);
                const label = !a ? "–" : a.status === "APPROVED" ? "✓ Approved" : a.status === "PENDING" ? "Waiting" : a.status === "SENT_BACK" ? "Sent back" : "Rejected";
                return (
                  <td key={r} className={cx(tbl.td, "whitespace-nowrap font-medium", a?.status === "APPROVED" ? "text-emerald-700" : a?.status === "PENDING" ? "text-amber-700" : a ? "text-red-700" : "text-stone-400")}>
                    {label}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {(sentBack.length > 0 || over.length > 0 || shorts.length > 0) && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-[13px] text-amber-900">
          {sentBack.length > 0 && <div>Sent back, {sentBack.map((a) => `${a.role}: “${a.comment}”`).join("; ")}</div>}
          {over.length > 0 && <div>Line over capacity in {over.map((a) => monthLabel(a.month)).join(", ")}</div>}
          {shorts.length > 0 && <div>Materials to buy: {[...new Set(shorts.map((x) => x.name.replace("Green beans · ", "")))].join(", ")}</div>}
        </div>
      )}

      {signable.length > 0 && (
        <div className="mb-3 rounded-md border border-brand-200 bg-brand-50 px-3 py-2">
          <DecisionForm key={signable.join()} orderId={order.id} roles={signable} allAccess={viewer.role === "ALL"} />
        </div>
      )}

      <Tabs active={String(tab)} tabs={tabs.map((t) => ({ ...t, href: `/orders/${order.id}?tab=${t.key}` }))} />

      {tab === "plan" && (
        <div className="overflow-x-auto rounded-md border border-stone-300 bg-white">
          <table className="tabular w-full min-w-[560px] text-[13px]">
            <thead>
              <tr>
                <th className={tbl.th}>Month</th>
                <th className={tbl.th}>Line</th>
                <th className={tbl.thR}>Tonnes</th>
                <th className={tbl.th}>Line space</th>
                <th className={tbl.th}>Materials</th>
                <th className={tbl.thR}>Made</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((a) => {
                const cap = capacityAt(state, a.lineId, a.month);
                const used = loadAt(state, a.lineId, a.month);
                const ms = shorts.filter((x) => x.month === a.month);
                return (
                  <tr key={a.id} className={tbl.tr}>
                    <td className={tbl.td}>{monthLabel(a.month)}</td>
                    <td className={tbl.td}>{a.lineCode}</td>
                    <td className={tbl.tdR}>{a.quantityMt.toLocaleString("en-IN")}</td>
                    <td className={cx(tbl.td, used > cap + 0.05 ? "font-semibold text-red-700" : "text-emerald-700")}>{used > cap + 0.05 ? `Over by ${(used - cap).toFixed(0)} t` : "OK"}</td>
                    <td className={cx(tbl.td, ms.length ? "font-semibold text-amber-700" : "text-emerald-700")}>{ms.length ? "To buy" : "OK"}</td>
                    <td className={tbl.tdR}>
                      {(() => {
                        const made = "producedMt" in a ? (a.producedMt as number | undefined) : undefined;
                        if (made == null) return <span className="text-stone-400">–</span>;
                        return <span className={made >= a.quantityMt - 0.05 ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>{made.toLocaleString("en-IN")}</span>;
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === "details" && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-md border border-stone-300 bg-white">
            <table className="w-full text-[13px]">
              <tbody>
                {(
                  [
                    ["Contact", order.contactPerson, "Deliver to", `${order.destinationPort}, ${order.destinationCountry}`],
                    ["Customer type", order.customerType === "NEW" ? "New" : "Repeat", "Freight", FREIGHT_BASIS[order.freightBasis as keyof typeof FREIGHT_BASIS]],
                    ["Bean origin", `${ORIGINS[order.beanOrigin as Origin]} · ${order.gbGrade}`, "Shipping term", order.incoterm],
                    ["Bean price", order.gbPriceClosed ? `Fixed ₹${order.gbClosedPrice}/kg` : `Market ₹${s[`bean_price.${order.beanOrigin}`]}/kg`, "Price", commercials ? `${cur}${lines[0]?.pricePerKg.toLocaleString("en-IN")}/kg` : "–"],
                    ["Beans needed", `${(margin.greenBeanKg / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} t`, "Payment", `${order.paymentMode} · ${order.advancePct}% advance · ${order.creditDays} days`],
                  ] as string[][]
                ).map((r) => (
                  <tr key={r[0]}>
                    <td className={cx(tbl.td, "w-36 bg-stone-50 text-stone-500")}>{r[0]}</td>
                    <td className={tbl.td}>{r[1]}</td>
                    <td className={cx(tbl.td, "w-36 bg-stone-50 text-stone-500")}>{r[2]}</td>
                    <td className={tbl.td}>{r[3]}</td>
                  </tr>
                ))}
                {(order.specNotes || order.spillOverride) && (
                  <tr>
                    <td className={cx(tbl.td, "bg-stone-50 text-stone-500")}>Notes</td>
                    <td className={tbl.td} colSpan={3}>
                      {[order.specNotes, order.spillOverride && `Asked COO for room: ${order.spillOverride}`].filter(Boolean).join(" · ")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {can(viewer.role, ["PROCUREMENT", "COO"]) && <GbClosureForm orderId={order.id} closed={order.gbPriceClosed} price={order.gbClosedPrice} marketPrice={s[`bean_price.${order.beanOrigin}`]} compact />}
          {can(viewer.role, ["BD_HEAD"]) && <ReassignForm orderId={order.id} owners={bdUsers().map((u) => ({ id: u.id, name: u.name }))} ownerId={order.bdOwnerId} priority={order.priority} />}
        </div>
      )}

      {tab === "costs" && commercials && lines[0]?.margin && (
        <div className="max-w-lg overflow-x-auto rounded-md border border-stone-300 bg-white">
          <table className="tabular w-full text-[13px]">
            <thead>
              <tr>
                <th className={tbl.th}>Per kg{data.snapshot ? " (as priced)" : ""}</th>
                <th className={tbl.thR}>₹</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={tbl.td}>Selling price</td>
                <td className={tbl.tdR}>{formatPerKg(lines[0].margin.priceInrPerKg)}</td>
              </tr>
              {lines[0].margin.lines.map((c) => (
                <tr key={c.label}>
                  <td className={cx(tbl.td, "text-stone-600")}>− {c.label}</td>
                  <td className={tbl.tdR}>{formatPerKg(c.perKg)}</td>
                </tr>
              ))}
              <tr className="bg-stone-50 font-semibold">
                <td className={tbl.td}>Profit per kg</td>
                <td className={tbl.tdR}>{formatPerKg(lines[0].margin.marginPerKg)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {tab === "history" && (
        <div className="overflow-x-auto rounded-md border border-stone-300 bg-white">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className={tbl.th}>Date</th>
                <th className={tbl.th}>Who</th>
                <th className={tbl.th}>What happened</th>
              </tr>
            </thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.id}>
                  <td className={cx(tbl.td, "whitespace-nowrap text-stone-500")}>{formatDate(l.at.toISOString())}</td>
                  <td className={cx(tbl.td, "whitespace-nowrap")}>{l.by}</td>
                  <td className={tbl.td}>{l.detail}</td>
                </tr>
              ))}
              {revisions
                .filter((r) => r.version > 1)
                .map((r) => (
                  <tr key={`rev-${r.id}`}>
                    <td className={cx(tbl.td, "whitespace-nowrap text-stone-500")}>v{r.version}</td>
                    <td className={tbl.td}>{r.by}</td>
                    <td className={tbl.td}>
                      {r.changes.slice(0, 5).join("; ")}
                      {r.reapproval && <span className="ml-1 text-amber-700">(needed re-approval)</span>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
