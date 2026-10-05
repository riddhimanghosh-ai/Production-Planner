import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelOrderButton, DecisionForm, GbClosureForm, ReassignForm } from "@/components/approval-actions";
import { Badge, ButtonLink, cx, StatusBadge, Tabs, tbl } from "@/components/ui";
import { capacityAt, loadAt, loadCapacityState } from "@/lib/capacity";
import { beanPrice, can, formatDate, formatInr, formatPerKg, FREIGHT_BASIS, monthLabel, ORIGINS, productLabel, type Origin } from "@/lib/domain";
import { shortages } from "@/lib/inventory";
import { bdUsers, getOrderView } from "@/lib/queries";
import { getViewer } from "@/lib/role";
import { loadSettings } from "@/lib/settings";
import { orderFeasibility, type Feasibility } from "@/lib/feasibility";
import { canEditOrder } from "@/lib/workflow";
import { store } from "@/data/store";

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
  const sentBack = approvals.filter((a) => a.status === "SENT_BACK");
  const feas = orderFeasibility(order.id);
  // Lots made for this order: batches logged on days that were running one of its slots.
  const st = store();
  const slotIds = new Set(allocations.map((a) => a.id));
  const lots = st.dayLogs
    .filter((d) => d.allocationId && slotIds.has(d.allocationId))
    .flatMap((d) => (d.batches ?? []).map((b) => ({ ...b, date: d.date, line: st.lines.find((l) => l.id === d.lineId)?.code ?? "" })))
    .sort((a, b) => a.lotNo.localeCompare(b.lotNo));

  const tabs = [
    { key: "plan", label: "Production plan" },
    { key: "coo", label: "COO check" },
    { key: "details", label: "Details" },
    ...(commercials && lines[0]?.margin ? [{ key: "costs", label: "Costs" }] : []),
    { key: "history", label: "History" },
  ];

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
              <th className={tbl.th}>Ship month</th>
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
              <td className={tbl.td}>{monthLabel(order.shipments?.[0]?.month ?? data.firstMonth)}</td>
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

      {sentBack.length > 0 && <div className="mb-3 border border-amber-300 bg-amber-50 px-3 py-1.5 text-[13px] text-amber-900">Sent back: {sentBack.map((a) => `${a.role}: “${a.comment}”`).join("; ")}</div>}

      {feas && !["REJECTED", "CANCELLED"].includes(order.status) && (
        <div className="mb-3 border border-stone-300 bg-white">
          <div className={cx("border-b border-stone-300 px-3 py-2 text-[14px] font-semibold", feas.verdict === "ok" ? "text-emerald-700" : feas.verdict === "buy" ? "text-stone-900" : "text-red-700")}>
            <span className="mr-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">COO check</span>
            {feas.headline}
            {tab !== "coo" && (
              <Link href={`/orders/${order.id}?tab=coo`} className="ml-3 text-[12px] font-normal text-stone-500 underline underline-offset-2 hover:text-stone-900">
                See the full check
              </Link>
            )}
          </div>
          <table className="w-full text-[13px]">
            <tbody>
              <tr>
                <td className={cx(tbl.td, "w-40 bg-stone-50 text-stone-500")}>Line space</td>
                <td className={cx(tbl.td, feas.line.ok ? "text-emerald-700" : "text-red-700")}>
                  {feas.line.ok ? "Room on a line that makes this product in the ship month" : feas.line.short.map((x) => `${x.short} t short in ${monthLabel(x.month)}`).join(" · ")}
                </td>
              </tr>
              <tr>
                <td className={cx(tbl.td, "bg-stone-50 text-stone-500")}>Materials</td>
                <td className={tbl.td}>
                  {feas.materials.length === 0 ? (
                    <span className="text-emerald-700">Covered by stock and purchases on the way</span>
                  ) : (
                    feas.materials.map((m) => (
                      <div key={`${m.name}-${m.month}`} className={m.canArrive ? "text-stone-900" : "text-red-700"}>
                        {m.name}: {m.short.toLocaleString("en-IN", { maximumFractionDigits: 1 })} {m.unit === "kg" ? "kg" : m.unit} short in {monthLabel(m.month)},{" "}
                        {m.canArrive ? `order by ${m.late ? "now" : m.orderBy.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : `can't arrive before ${monthLabel(m.earliest)}`}
                      </div>
                    ))
                  )}
                </td>
              </tr>
              {feas.bean && (
                <tr>
                  <td className={cx(tbl.td, "bg-stone-50 text-stone-500")}>Input costs</td>
                  <td className={cx(tbl.td, feas.bean.risk === "high" ? "text-red-700" : "text-stone-900")}>
                    Beans {feas.bean.fixed ? `fixed at ₹${feas.bean.pricedAt}/kg` : `not fixed, market ₹${feas.bean.marketNow}/kg`} ({feas.bean.shareOfCost.toFixed(0)}% of cost)
                    {feas.bean.costs
                      .filter((c) => c.then != null && Math.abs(c.now - c.then) >= 0.5)
                      .map((c) => ` · ${c.label} ${c.now > (c.then ?? 0) ? "up" : "down"} ₹${Math.round(Math.abs(c.now - (c.then ?? 0)))}/kg`)
                      .join("")}{" "}
                    · margin at today&apos;s costs {feas.bean.marginToday.toFixed(1)}%
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {signable.length > 0 && (
        <div className="mb-3 rounded-md border border-brand-200 bg-brand-50 px-3 py-2">
          <DecisionForm key={signable.join()} orderId={order.id} roles={signable} allAccess={viewer.role === "ALL"} />
        </div>
      )}

      <Tabs active={String(tab)} tabs={tabs.map((t) => ({ ...t, href: `/orders/${order.id}?tab=${t.key}` }))} />

      {tab === "plan" && (
        <>
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
          {lots.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-md border border-stone-300 bg-white">
              <table className="tabular w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr>
                    <th className={tbl.th}>Lot no.</th>
                    <th className={tbl.th}>Made on</th>
                    <th className={tbl.th}>Line</th>
                    <th className={tbl.thR}>Output</th>
                    <th className={tbl.th}>QC</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map((b) => (
                    <tr key={b.id} className={cx(tbl.tr, b.qc === "HOLD" && "bg-red-50/50")}>
                      <td className={cx(tbl.td, "font-mono text-[12px]")}>{b.lotNo}</td>
                      <td className={cx(tbl.td, "whitespace-nowrap")}>{formatDate(b.date)}</td>
                      <td className={tbl.td}>{b.line}</td>
                      <td className={cx(tbl.tdR, "font-semibold")}>{b.outputKg.toLocaleString("en-IN")} kg</td>
                      <td className={cx(tbl.td, "font-semibold", b.qc === "RELEASED" ? "text-emerald-700" : b.qc === "HOLD" ? "text-red-700" : "text-stone-500")}>
                        {b.qc === "RELEASED" ? "Released" : b.qc === "HOLD" ? "On hold" : "QC pending"}
                        {b.note && <span className="ml-1 font-normal text-stone-500">· {b.note}</span>}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-stone-50 font-semibold">
                    <td className={tbl.td} colSpan={3}>
                      {lots.length} lots
                    </td>
                    <td className={tbl.tdR}>{lots.reduce((a, b) => a + b.outputKg, 0).toLocaleString("en-IN")} kg</td>
                    <td className={cx(tbl.td, lots.some((b) => b.qc !== "RELEASED") ? "text-red-700" : "text-emerald-700")}>
                      {lots.filter((b) => b.qc === "RELEASED").length} of {lots.length} released
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="border-t border-stone-200 px-3 py-1.5 text-[11px] text-stone-500">Only released lots can ship. Lot numbers trace a bag back to the line and day it was made.</p>
            </div>
          )}
        </>
      )}

      {tab === "coo" && feas && <CooCheck feas={feas} />}

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
                    ["Bean price", order.gbPriceClosed ? `Fixed ₹${order.gbClosedPrice}/kg` : `Market ₹${beanPrice(s, order.beanOrigin, order.gbGrade)}/kg`, "Price", commercials ? `${cur}${lines[0]?.pricePerKg.toLocaleString("en-IN")}/kg` : "–"],
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
          {can(viewer.role, ["PROCUREMENT", "COO"]) && <GbClosureForm orderId={order.id} closed={order.gbPriceClosed} price={order.gbClosedPrice} marketPrice={beanPrice(s, order.beanOrigin, order.gbGrade)} compact />}
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

const ORIGINS_LABEL: Record<string, string> = ORIGINS;
const link = "underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600";
const eyebrow = "mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-700";

// The COO's full availability check: line space by ship month, ways to make it fit, and materials against stock and lead time.
function CooCheck({ feas }: { feas: Feasibility }) {
  return (
    <div className="space-y-5">
      <section>
        <div className={eyebrow}>1 · Line space in the ship month</div>
        {feas.perMonth.map((m) => (
          <div key={m.month} className="overflow-x-auto border border-stone-300 bg-white">
            <table className="tabular w-full min-w-[640px] text-[13px]">
              <thead>
                <tr>
                  <th className={tbl.th}>Line ({monthLabel(m.month)})</th>
                  <th className={tbl.thR}>Free for {feas.product}</th>
                  <th className={tbl.thR}>Free on the whole line</th>
                  <th className={tbl.thR}>Suggested here</th>
                </tr>
              </thead>
              <tbody>
                {m.lines.map((l) => (
                  <tr key={l.code} className={tbl.tr}>
                    <td className={cx(tbl.td, "font-medium")}>{l.code}</td>
                    <td className={cx(tbl.tdR, l.free < 0.05 && "text-stone-400")}>{l.free} t</td>
                    <td className={cx(tbl.tdR, "text-stone-500")}>{l.freeTotal} t</td>
                    <td className={cx(tbl.tdR, l.take ? "font-semibold text-stone-900" : "text-stone-300")}>{l.take ? `${l.take} t` : "–"}</td>
                  </tr>
                ))}
                <tr className={cx("font-semibold", m.short > 0.05 ? "bg-red-50" : "bg-emerald-50")}>
                  <td className={tbl.td}>Needed {m.need} t</td>
                  <td className={tbl.tdR}>{Math.round(m.lines.reduce((a, l) => a + l.free, 0) * 10) / 10} t</td>
                  <td className={tbl.tdR}>{Math.round(m.lines.reduce((a, l) => a + l.freeTotal, 0) * 10) / 10} t</td>
                  <td className={cx(tbl.tdR, m.short > 0.05 ? "text-red-700" : "text-emerald-700")}>{m.short > 0.05 ? `Short ${m.short} t` : "✓ Fits"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
        <p className="mt-1 text-[12px] text-stone-500">
          <b>Free for {feas.product}</b>: what is left of the {feas.product.toLowerCase()} share set in Line setup, after all other orders. <b>Free on the whole line</b>: what is left if the line&apos;s split between products were changed.
          {feas.perMonth.some((m) => m.fitsWithMix) && " This order would fit if a line's split were changed."}
        </p>
      </section>

      {!feas.line.ok && (
        <section>
          <div className={eyebrow}>2 · Ways to make it work</div>
          <div className="border border-stone-300 bg-white">
            <table className="w-full text-[13px]">
              <tbody>
                <tr>
                  <td className={cx(tbl.td, "w-56 bg-stone-50 text-stone-500")}>Ship in other months</td>
                  <td className={tbl.td}>
                    {feas.suggestion ? (
                      <>
                        The whole order fits from <b>{monthLabel(feas.suggestion)}</b>. Agree the new dates with the customer, or send it back to sales.
                      </>
                    ) : (
                      "No window in the next 18 months fits the whole order."
                    )}
                  </td>
                </tr>
                <tr>
                  <td className={cx(tbl.td, "bg-stone-50 text-stone-500")}>Change the line split</td>
                  <td className={tbl.td}>
                    {feas.perMonth.some((m) => m.fitsWithMix) ? (
                      <>
                        {feas.perMonth
                          .filter((m) => m.fitsWithMix)
                          .map((m) => monthLabel(m.month))
                          .join(", ")}{" "}
                        would fit if more of a line is given to this product.{" "}
                        <Link href="/capacity" className={link}>
                          Open Line setup
                        </Link>
                      </>
                    ) : (
                      "The lines are full in total too, so changing the split won't help."
                    )}
                  </td>
                </tr>
                <tr>
                  <td className={cx(tbl.td, "bg-stone-50 text-stone-500")}>Ask the planner</td>
                  <td className={tbl.td}>
                    Move other orders or add capacity in the short months:{" "}
                    <Link href="/plan?tab=new" className={link}>
                      Production calendar, New orders
                    </Link>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {feas.bean && (
        <section>
          <div className={eyebrow}>{feas.line.ok ? "2" : "3"} · Input costs: green beans, chicory, making, packing, freight</div>
          <div className="mb-3 overflow-x-auto border border-stone-300 bg-white">
            <table className="tabular w-full min-w-[640px] text-[13px]">
              <thead>
                <tr>
                  <th className={tbl.th}>Cost, per kg of product</th>
                  <th className={tbl.thR}>When priced</th>
                  <th className={tbl.thR}>Today</th>
                  <th className={tbl.thR}>Change</th>
                  <th className={tbl.thR}>Share of cost</th>
                </tr>
              </thead>
              <tbody>
                {feas.bean.costs.map((c) => {
                  const diff = c.then == null ? 0 : c.now - c.then;
                  return (
                    <tr key={c.label} className={tbl.tr}>
                      <td className={cx(tbl.td, "font-medium")}>{c.label}</td>
                      <td className={cx(tbl.tdR, "text-stone-600")}>{c.then == null ? "–" : `₹${Math.round(c.then).toLocaleString("en-IN")}`}</td>
                      <td className={tbl.tdR}>₹{Math.round(c.now).toLocaleString("en-IN")}</td>
                      <td className={cx(tbl.tdR, Math.abs(diff) < 0.5 ? "text-stone-400" : diff > 0 ? "font-semibold text-red-700" : "font-semibold text-emerald-700")}>
                        {Math.abs(diff) < 0.5 ? "no change" : `${diff > 0 ? "+" : "−"}₹${Math.round(Math.abs(diff))}`}
                      </td>
                      <td className={tbl.tdR}>{c.share.toFixed(0)}%</td>
                    </tr>
                  );
                })}
                <tr className="bg-stone-50 font-semibold">
                  <td className={tbl.td}>Total cost</td>
                  <td className={tbl.tdR}>{feas.bean.costs.some((c) => c.then == null) ? "–" : `₹${Math.round(feas.bean.costs.reduce((a, c) => a + (c.then ?? 0), 0)).toLocaleString("en-IN")}`}</td>
                  <td className={tbl.tdR}>₹{Math.round(feas.bean.costs.reduce((a, c) => a + c.now, 0)).toLocaleString("en-IN")}</td>
                  <td className={tbl.tdR} />
                  <td className={tbl.tdR}>100%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className={eyebrow}>Green beans, the biggest input</div>
          <div className="border border-stone-300 bg-white">
            <table className="tabular w-full text-[13px]">
              <tbody>
                <tr>
                  <td className={cx(tbl.td, "w-56 bg-stone-50 text-stone-500")}>Beans</td>
                  <td className={tbl.td}>
                    {ORIGINS_LABEL[feas.bean.origin] ?? feas.bean.origin} · {feas.bean.grade} · {feas.bean.beanTonnes} t needed
                  </td>
                </tr>
                <tr>
                  <td className={cx(tbl.td, "bg-stone-50 text-stone-500")}>Price the order was costed on</td>
                  <td className={tbl.td}>
                    ₹{feas.bean.pricedAt}/kg {feas.bean.fixed ? <b className="text-emerald-700">fixed with the supplier</b> : <b>market price, not fixed</b>}
                  </td>
                </tr>
                <tr>
                  <td className={cx(tbl.td, "bg-stone-50 text-stone-500")}>Market price today</td>
                  <td className={tbl.td}>
                    ₹{feas.bean.marketNow}/kg{" "}
                    {Math.abs(feas.bean.changePct) >= 0.5 && (
                      <span className={feas.bean.changePct > 0 ? "text-red-700" : "text-emerald-700"}>
                        ({feas.bean.changePct > 0 ? "+" : ""}
                        {feas.bean.changePct.toFixed(1)}% since costed)
                      </span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td className={cx(tbl.td, "bg-stone-50 text-stone-500")}>Share of cost</td>
                  <td className={tbl.td}>Green beans are {feas.bean.shareOfCost.toFixed(0)}% of this order&apos;s cost</td>
                </tr>
                <tr>
                  <td className={cx(tbl.td, "bg-stone-50 text-stone-500")}>Margin</td>
                  <td className={cx(tbl.td, "font-semibold", feas.bean.marginToday < feas.bean.minPct ? "text-red-700" : "text-emerald-700")}>
                    {feas.bean.marginToday.toFixed(1)}% at today&apos;s costs
                    {feas.bean.marginThen != null && <span className="font-normal text-stone-500"> (was {feas.bean.marginThen.toFixed(1)}% when priced)</span>} · minimum {feas.bean.minPct}%
                  </td>
                </tr>
                <tr>
                  <td className={cx(tbl.td, "bg-stone-50 text-stone-500")}>Risk</td>
                  <td className={cx(tbl.td, feas.bean.risk === "high" ? "text-red-700" : "text-stone-700")}>{feas.bean.note}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <div className={eyebrow}>{(feas.line.ok ? 2 : 3) + (feas.bean ? 1 : 0)} · Materials, stock and lead time</div>
        <div className="overflow-x-auto border border-stone-300 bg-white">
          <table className="tabular w-full min-w-[720px] text-[13px]">
            <thead>
              <tr>
                <th className={tbl.th}>Material</th>
                <th className={tbl.th}>Short in</th>
                <th className={tbl.thR}>Short by</th>
                <th className={tbl.thR}>Lead time</th>
                <th className={tbl.th}>Order by</th>
                <th className={tbl.th}>Can it arrive in time?</th>
              </tr>
            </thead>
            <tbody>
              {feas.materials.length === 0 && (
                <tr>
                  <td colSpan={6} className={cx(tbl.td, "text-emerald-700")}>
                    Every material is covered by stock and purchases on the way.
                  </td>
                </tr>
              )}
              {feas.materials.map((m) => (
                <tr key={`${m.name}-${m.month}`} className={cx(tbl.tr, !m.canArrive && "bg-red-50/50")}>
                  <td className={cx(tbl.td, "font-medium")}>{m.name}</td>
                  <td className={tbl.td}>{monthLabel(m.month)}</td>
                  <td className={cx(tbl.tdR, "font-semibold text-red-700")}>{m.unit === "kg" ? `${(m.short / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} t` : `${Math.round(m.short).toLocaleString("en-IN")} ${m.unit}`}</td>
                  <td className={cx(tbl.tdR, "text-stone-600")}>{m.leadDays} days</td>
                  <td className={cx(tbl.td, m.late && "font-semibold text-red-700")}>{m.late ? "Now" : m.orderBy.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td>
                  <td className={cx(tbl.td, "font-semibold", m.canArrive ? "text-emerald-700" : "text-red-700")}>{m.canArrive ? "Yes, if ordered by then" : `No, earliest ${monthLabel(m.earliest)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[12px] text-stone-500">Stock and purchases on the way are counted month by month; lead time is the supplier&apos;s time to deliver.</p>
      </section>
    </div>
  );
}
