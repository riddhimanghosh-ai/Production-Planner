import Link from "next/link";
import { QuickDecision } from "@/components/approval-actions";
import { ExportButton } from "@/components/export-button";
import { Badge, ButtonLink, cx, Empty, PageHeader, Pager, Segmented, StatusBadge, Tabs, tbl, type StatItem, type Tone } from "@/components/ui";
import { can, formatInr, monthLabel, ORDER_STATUS, productLabel, type OrderStatus } from "@/lib/domain";
import { shortages } from "@/lib/inventory";
import { Sellable } from "@/components/sellable";
import { loadCapacityState, packLoadAt, planHorizon } from "@/lib/capacity";
import { openRoom } from "@/lib/recommend";
import { orderFeasibility, type Feasibility } from "@/lib/feasibility";
import { loadSettings } from "@/lib/settings";
import { activeSkus, approvalQueue, listOrderViews, type OrderView } from "@/lib/queries";
import { getViewer } from "@/lib/role";

const FILTERS: { key: string; label: string; statuses: string[] }[] = [
  { key: "all", label: "All", statuses: [] },
  { key: "draft", label: "Drafts", statuses: ["DRAFT"] },
  { key: "waiting", label: "Waiting for approval", statuses: ["PENDING_APPROVAL"] },
  { key: "sentback", label: "Sent back", statuses: ["SENT_BACK"] },
  { key: "approved", label: "Approved", statuses: ["COMMITTED"] },
  { key: "closed", label: "Rejected / cancelled", statuses: ["REJECTED", "CANCELLED"] },
];

// CFO / COO decision as two small labelled tags.
function ApprovalTags({ v }: { v: OrderView }) {
  const st = v.order.status;
  if (st === "DRAFT") return <span className="text-[12px] text-stone-400">Not sent</span>;
  return (
    <div className="flex gap-2.5">
      {(["CFO", "COO"] as const).map((role) => {
        const raw = v.approvals.find((x) => x.role === role)?.status;
        // A pending review on an order that is no longer waiting was never reached — show it as empty.
        const a = raw === "PENDING" && st !== "PENDING_APPROVAL" ? undefined : raw;
        const [icon, cls] = a === "APPROVED" ? ["✓", "text-emerald-700"] : a === "PENDING" ? ["…", "text-stone-900"] : a ? ["✕", "text-red-700"] : ["–", "text-stone-400"];
        return (
          <span key={role} className="whitespace-nowrap font-mono text-[11px] text-stone-500" title={`${role}: ${a === "APPROVED" ? "approved" : a === "PENDING" ? "waiting" : a === "SENT_BACK" ? "sent back" : a === "REJECTED" ? "rejected" : "–"}`}>
            {role} <span className={cx("font-semibold", cls)}>{icon}</span>
          </span>
        );
      })}
    </div>
  );
}

// What happens next, in a few words.
function nextStep(v: OrderView) {
  const waiting = v.approvals.filter((a) => a.status === "PENDING").map((a) => a.role);
  switch (v.order.status) {
    case "DRAFT":
      return "Salesperson to send";
    case "PENDING_APPROVAL":
      return waiting.length ? `${waiting.join(" & ")} to decide` : "Deciding";
    case "SENT_BACK":
      return "Salesperson to fix";
    case "COMMITTED":
      return "Line time locked";
    case "REJECTED":
      return "Closed";
    default:
      return "Capacity released";
  }
}

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const sp = await searchParams;
  const tab = sp.tab === "approvals" ? "approvals" : sp.tab === "sell" ? "sell" : "orders";
  const viewer = await getViewer();
  const queue = approvalQueue(viewer);
  const mine = queue.filter((q) => q.waitingOn.some((r) => viewer.role === "ALL" || r === viewer.role));

  // Key numbers for the header: what is waiting, what is approved, and how the approved book is doing on margin.
  const all = listOrderViews(viewer);
  const waiting = all.filter((v) => v.order.status === "PENDING_APPROVAL").length;
  const open = all.filter((v) => !["REJECTED", "CANCELLED"].includes(v.order.status)).length;
  const approved = all.filter((v) => v.order.status === "COMMITTED");
  const approvedT = approved.reduce((a, v) => a + v.totalMt, 0);
  const priced = approved.filter((v) => v.commercials);
  const avgMargin = priced.length ? priced.reduce((a, v) => a + v.margin.marginPct, 0) / priced.length : null;
  const target = priced[0]?.margin.targetPct ?? 0;
  const stats: StatItem[] = [
    { label: "Waiting for approval", value: waiting, hint: waiting ? "CFO and COO to decide" : "Nothing waiting" },
    { label: "Approved orders", value: approved.length, hint: `${open} open in total` },
    { label: "Approved tonnes", value: `${approvedT.toLocaleString("en-IN")} t`, hint: "Line time locked" },
    { label: "Average margin", value: avgMargin == null ? "–" : `${avgMargin.toFixed(1)}%`, hint: avgMargin == null ? "Hidden for this role" : `Target ${target}%`, tone: avgMargin == null ? undefined : avgMargin < target ? "red" : "green" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="01 / Orders"
        title="Orders &"
        emph="approvals"
        subtitle="The CFO checks the money and the COO checks the factory; both must approve."
        actions={can(viewer.role, ["BD_EXEC", "BD_HEAD"]) ? <ButtonLink href="/orders/new">+ New order</ButtonLink> : undefined}
        stats={stats}
      />
      <Tabs
        active={tab}
        tabs={[
          { key: "orders", label: "All orders", href: "/orders?tab=orders" },
          { key: "approvals", label: "Approvals", href: "/orders?tab=approvals", count: queue.length },
          { key: "sell", label: "What we can sell", href: "/orders?tab=sell" },
        ]}
      />
      {tab === "orders" ? (
        <OrderList sp={sp} viewer={viewer} />
      ) : tab === "sell" ? (
        <SellTab canCreate={can(viewer.role, ["BD_EXEC", "BD_HEAD"])} view={sp.view === "product" || sp.view === "pack" ? sp.view : "code"} />
      ) : (
        <Approvals queue={queue} mineCount={mine.length} viewer={viewer} />
      )}
    </>
  );
}

async function OrderList({ sp, viewer }: { sp: Record<string, string | string[] | undefined>; viewer: Awaited<ReturnType<typeof getViewer>> }) {
  const views = listOrderViews(viewer);
  const filter = FILTERS.find((f) => f.key === sp.status) ?? FILTERS[0];
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const rows = views.filter((v) => (!filter.statuses.length || filter.statuses.includes(v.order.status)) && (!q || v.customer.name.toLowerCase().includes(q) || v.order.ref.toLowerCase().includes(q)));
  const PAGE = 10;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pages);
  const pageHref = (p: number) => `/orders?status=${filter.key}${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${p}`;
  const exportRows = [
    ["Order", "Customer", "Salesperson", "Product", "Tonnes", "From", "To", "Value (INR)", "Profit %", "Status"],
    ...rows.map((v) => [
      v.order.ref,
      v.customer.name,
      v.owner?.name,
      v.lines[0] ? productLabel(v.lines[0].sku, v.lines[0].chicoryPct) : "",
      v.totalMt,
      monthLabel(v.firstMonth),
      monthLabel(v.lastMonth),
      v.commercials ? Math.round(v.margin.revenue) : "restricted",
      v.commercials ? v.margin.marginPct.toFixed(1) : "",
      ORDER_STATUS[v.order.status as OrderStatus],
    ]),
  ];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          active={filter.key}
          items={FILTERS.map((f) => {
            const count = f.statuses.length ? views.filter((v) => f.statuses.includes(v.order.status)).length : views.length;
            return {
              key: f.key,
              href: `/orders?status=${f.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
              label: (
                <>
                  {f.label}
                  <span className={cx("font-mono text-[11px]", filter.key === f.key ? "text-white/70" : "text-stone-400")}>{count}</span>
                </>
              ),
            };
          })}
        />
        <form className="ml-auto flex items-center gap-2">
          <input type="hidden" name="status" value={filter.key} />
          <input name="q" defaultValue={q} placeholder="Search customer or order" className="w-56" />
        </form>
        <ExportButton filename="sln-orders" rows={exportRows} />
      </div>

      {rows.length === 0 ? (
        <Empty>No orders here.</Empty>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {rows.slice((page - 1) * PAGE, page * PAGE).map((v) => {
              const first = v.lines[0];
              return (
                <Link key={v.order.id} href={`/orders/${v.order.id}`} className="block border border-stone-300 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-semibold text-stone-900">{v.customer.name}</div>
                      <div className="font-mono text-[11px] text-stone-500">
                        {v.order.ref} · {v.owner?.name}
                      </div>
                    </div>
                    <StatusBadge status={v.order.status} />
                  </div>
                  <div className="mt-2 text-[13px] text-stone-700">{first ? productLabel(first.sku, first.chicoryPct) : "–"}</div>
                  <div className="mt-2 grid grid-cols-3 gap-2 border-t border-stone-200 pt-2 text-[12px]">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-stone-500">Tonnes</div>
                      <div className="font-semibold text-stone-900">{v.totalMt.toLocaleString("en-IN")} t</div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-stone-500">Ships</div>
                      <div className="font-semibold text-stone-900">{monthLabel(v.order.shipments?.[0]?.month ?? v.firstMonth)}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-stone-500">Margin</div>
                      <div className={cx("font-semibold", v.commercials ? (v.margin.marginPct >= v.margin.targetPct ? "text-emerald-700" : "text-red-700") : "text-stone-400")}>{v.commercials ? `${v.margin.marginPct.toFixed(1)}%` : "–"}</div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-stone-500">
                    <ApprovalTags v={v} />
                    <span>{nextStep(v)}</span>
                  </div>
                </Link>
              );
            })}
            <Pager page={page} pages={pages} total={rows.length} href={pageHref} />
          </div>
          <div className={cx(tbl.wrap, "hidden md:block")}>
            <table className={tbl.table}>
              <thead>
                <tr>
                  <th className={tbl.th}>Order</th>
                  <th className={tbl.th}>Customer</th>
                  <th className={tbl.th}>Salesperson</th>
                  <th className={tbl.th}>Product</th>
                  <th className={tbl.thR}>Tonnes</th>
                  <th className={tbl.th}>Ship month</th>
                  <th className={tbl.thR}>Value</th>
                  <th className={tbl.thR}>Profit</th>
                  <th className={tbl.th}>Approvals</th>
                  <th className={tbl.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice((page - 1) * PAGE, page * PAGE).map((v) => {
                  const first = v.lines[0];
                  return (
                    <tr key={v.order.id} className={tbl.tr}>
                      <td className={cx(tbl.td, "whitespace-nowrap")}>
                        <Link href={`/orders/${v.order.id}`} className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
                          {v.order.ref}
                        </Link>
                        {v.order.priority === "HIGH" && <span className="ml-1 text-[11px] font-semibold text-red-700">HIGH</span>}
                      </td>
                      <td className={cx(tbl.td, "font-medium text-stone-900")}>{v.customer.name}</td>
                      <td className={cx(tbl.td, "text-stone-600")}>{v.owner?.name}</td>
                      <td className={tbl.td}>{first ? productLabel(first.sku, first.chicoryPct) : "–"}</td>
                      <td className={tbl.tdR}>{v.totalMt.toLocaleString("en-IN")}</td>
                      <td className={cx(tbl.td, "whitespace-nowrap")}>{monthLabel(v.order.shipments?.[0]?.month ?? v.firstMonth)}</td>
                      <td className={tbl.tdR}>{v.commercials ? formatInr(v.margin.revenue) : <span className="text-stone-400">hidden</span>}</td>
                      <td className={cx(tbl.tdR, "font-semibold", v.commercials && (v.margin.marginPct >= v.margin.targetPct ? "text-emerald-700" : "text-red-700"))}>{v.commercials ? `${v.margin.marginPct.toFixed(1)}%` : "–"}</td>
                      <td className={tbl.td}>
                        <ApprovalTags v={v} />
                      </td>
                      <td className={cx(tbl.td, "whitespace-nowrap")}>
                        <StatusBadge status={v.order.status} />
                        <div className="mt-0.5 text-[11px] text-stone-500">{nextStep(v)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pager page={page} pages={pages} total={rows.length} href={pageHref} />
          </div>
        </>
      )}
    </>
  );
}

function Approvals({ queue, mineCount, viewer }: { queue: ReturnType<typeof approvalQueue>; mineCount: number; viewer: Awaited<ReturnType<typeof getViewer>> }) {
  const shorts = shortages();
  const role = viewer.role;
  const intro = role === "CFO" ? `${mineCount} waiting for you.` : role === "COO" ? `${mineCount} waiting for you.` : "";

  if (!queue.length) return <Empty>Nothing is waiting for approval.</Empty>;
  return (
    <>
      {intro && <p className="mb-2 text-xs text-stone-600">{intro}</p>}
      <div className="space-y-2 md:hidden">
        {queue.map((q) => {
          const first = q.lines[0];
          const signable = q.approvals.filter((a) => a.status === "PENDING" && (role === "ALL" || a.role === role)).map((a) => a.role);
          const profitOk = q.margin.marginPct >= q.margin.targetPct;
          const f = orderFeasibility(q.order.id, shorts);
          return (
            <div key={q.order.id} className="border border-stone-300 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/orders/${q.order.id}`} className="block truncate text-[15px] font-semibold text-stone-900">
                    {q.customer.name}
                  </Link>
                  <div className="text-[12px] text-stone-600">
                    {first ? productLabel(first.sku, first.chicoryPct) : ""} · {monthLabel(q.firstMonth)}
                  </div>
                </div>
                <div className="text-right text-[12px]">
                  <div className="font-semibold text-stone-900">{q.totalMt.toLocaleString("en-IN")} t</div>
                  <div className={cx("font-semibold", profitOk ? "text-emerald-700" : "text-red-700")}>{q.margin.marginPct.toFixed(1)}%</div>
                </div>
              </div>
              <div className="mt-2 border-t border-stone-200 pt-2">{f && <FeasibilityCell f={f} beanFixed={q.order.gbPriceClosed} orderId={q.order.id} />}</div>
              <div className="mt-2 flex items-center gap-3 border-t border-stone-200 pt-2 text-[12px]">
                <span>
                  CFO <Decision status={q.approvals.find((a) => a.role === "CFO")?.status} />
                </span>
                <span>
                  COO <Decision status={q.approvals.find((a) => a.role === "COO")?.status} />
                </span>
                <span className={cx("ml-auto", q.daysPending >= 3 && "font-semibold text-red-700")}>waiting {q.daysPending}d</span>
              </div>
              {signable.length > 0 && (
                <div className="mt-2 border-t border-stone-200 pt-2">
                  <QuickDecision key={signable.join()} orderId={q.order.id} roles={signable} allAccess={role === "ALL"} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className={cx(tbl.wrap, "hidden md:block")}>
        <table className={cx(tbl.table, "min-w-[980px]")}>
          <thead>
            <tr>
              <th className={tbl.th}>Order</th>
              <th className={tbl.thR}>Tonnes</th>
              <th className={tbl.thR}>Value</th>
              <th className={tbl.thR}>Margin</th>
              <th className={tbl.th}>COO check: capacity and input costs</th>
              <th className={tbl.th}>CFO</th>
              <th className={tbl.th}>COO</th>
              <th className={tbl.thR}>Waiting</th>
              <th className={tbl.thR}>Decision</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((q) => {
              const first = q.lines[0];
              const signable = q.approvals.filter((a) => a.status === "PENDING" && (role === "ALL" || a.role === role)).map((a) => a.role);
              const profitOk = q.margin.marginPct >= q.margin.targetPct;
              const f = orderFeasibility(q.order.id, shorts);
              return (
                <tr key={q.order.id} className={tbl.tr}>
                  <td className={tbl.td}>
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <Link href={`/orders/${q.order.id}`} className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
                        {q.customer.name}
                      </Link>
                      {q.order.spillOverride && (
                        <span title={`Salesperson asks: ${q.order.spillOverride}`} className="cursor-help text-[11px] text-amber-700">
                          ● note
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-stone-500">
                      {first ? productLabel(first.sku, first.chicoryPct) : ""} · {monthLabel(q.firstMonth)}
                      {q.lastMonth !== q.firstMonth && `–${monthLabel(q.lastMonth)}`}
                    </div>
                  </td>
                  <td className={tbl.tdR}>{q.totalMt.toLocaleString("en-IN")}</td>
                  <td className={tbl.tdR}>{formatInr(q.margin.revenue)}</td>
                  <td className={cx(tbl.tdR, "font-semibold", profitOk ? "text-emerald-700" : "text-red-700")}>{q.margin.marginPct.toFixed(1)}%</td>
                  <td className={cx(tbl.td, "min-w-64")}>{f && <FeasibilityCell f={f} beanFixed={q.order.gbPriceClosed} orderId={q.order.id} />}</td>
                  <td className={tbl.td}>
                    <Decision status={q.approvals.find((a) => a.role === "CFO")?.status} />
                  </td>
                  <td className={tbl.td}>
                    <Decision status={q.approvals.find((a) => a.role === "COO")?.status} />
                  </td>
                  <td className={cx(tbl.tdR, q.daysPending >= 3 && "font-semibold text-red-700")}>{q.daysPending}d</td>
                  <td className={tbl.tdR}>{signable.length > 0 ? <QuickDecision key={signable.join()} orderId={q.order.id} roles={signable} allAccess={role === "ALL"} /> : <span className="text-xs text-stone-400">–</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// COO view of one order: verdict, then the two things checked in plain words.
function FeasibilityCell({ f, beanFixed, orderId }: { f: Feasibility; beanFixed: boolean; orderId: number }) {
  const date = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const m = f.materials[0];
  return (
    <div className="space-y-0.5 text-[12px]">
      <div className={cx("font-semibold", f.verdict === "ok" ? "text-emerald-700" : f.verdict === "buy" ? "text-stone-900" : "text-red-700")}>{f.verdict === "ok" ? "✓ Feasible" : f.verdict === "buy" ? "Feasible if we buy" : "✕ Not feasible"}</div>
      <div className="text-stone-600">
        Line: {f.line.ok ? <span className="text-emerald-700">room in the ship month</span> : <span className="text-red-700">short {f.line.short.map((x) => `${x.short} t in ${monthLabel(x.month)}`).join(", ")}</span>}
      </div>
      <div className="text-stone-600">
        Stock:{" "}
        {!m ? (
          <span className="text-emerald-700">covered by stock and purchases on the way</span>
        ) : !m.canArrive ? (
          <span className="text-red-700">
            {m.name} can&apos;t arrive before {monthLabel(m.earliest)}
          </span>
        ) : (
          <span>
            buy {m.name}
            {f.materials.length > 1 ? ` + ${f.materials.length - 1} more` : ""} by {m.late ? "now" : date(m.orderBy)}
          </span>
        )}
      </div>
      {f.bean && (
        <div className="text-stone-600">
          Beans:{" "}
          <span className={f.bean.risk === "high" ? "text-red-700" : f.bean.risk === "watch" ? "text-stone-900" : "text-emerald-700"}>
            {f.bean.fixed ? `fixed ₹${f.bean.pricedAt}/kg` : `market ₹${f.bean.marketNow}/kg, not fixed`} · margin {f.bean.marginToday.toFixed(1)}%
          </span>
        </div>
      )}
      {!beanFixed && !f.bean && <div className="text-stone-500">Bean price not fixed yet</div>}
      <Link href={`/orders/${orderId}?tab=coo`} className="text-[11px] text-stone-500 underline underline-offset-2 hover:text-stone-900">
        Full check
      </Link>
    </div>
  );
}

function Decision({ status }: { status?: string }) {
  if (!status) return null;
  const map: Record<string, [string, Tone]> = {
    PENDING: ["Waiting", "amber"],
    APPROVED: ["Approved", "green"],
    SENT_BACK: ["Sent back", "blue"],
    REJECTED: ["Rejected", "red"],
  };
  const [label, tone] = map[status] ?? [status, "neutral"];
  return <Badge tone={tone}>{label}</Badge>;
}

function SellTab({ canCreate, view }: { canCreate: boolean; view: "product" | "code" | "pack" }) {
  const months = planHorizon(12);
  const state = loadCapacityState();
  const s = loadSettings();
  const packs = ["GLASS", "CAN"].map((pack) => ({ pack, months: Object.fromEntries(months.map((m) => [m, Math.max(0, (s[`pack_capacity.${pack}`] ?? 0) - packLoadAt(state, pack, m))])) }));
  const skus = activeSkus().map((k) => ({ code: k.code, productType: k.productType, blend: k.blend, packFormat: k.packFormat }));
  return <Sellable view={view} months={months} room={openRoom(months)} packs={packs} skus={skus} canCreate={canCreate} />;
}
