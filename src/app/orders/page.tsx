import Link from "next/link";
import { QuickDecision } from "@/components/approval-actions";
import { ExportButton } from "@/components/export-button";
import { ButtonLink, cx, Empty, PageHeader, Pager, StatusBadge, Tabs, tbl } from "@/components/ui";
import { can, formatInr, monthLabel, ORDER_STATUS, productLabel, type OrderStatus, containerSummary } from "@/lib/domain";
import { shortages } from "@/lib/inventory";
import { Sellable } from "@/components/sellable";
import { loadCapacityState, packLoadAt, planHorizon } from "@/lib/capacity";
import { openRoom } from "@/lib/recommend";
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
    <div className="flex gap-1">
      {(["CFO", "COO"] as const).map((role) => {
        const raw = v.approvals.find((x) => x.role === role)?.status;
        // A pending review on an order that is no longer waiting was never reached — show it as empty.
        const a = raw === "PENDING" && st !== "PENDING_APPROVAL" ? undefined : raw;
        const [icon, cls] =
          a === "APPROVED"
            ? ["✓", "border-emerald-200 bg-emerald-50 text-emerald-800"]
            : a === "PENDING"
              ? ["…", "border-amber-200 bg-amber-50 text-amber-800"]
              : a
                ? ["✕", "border-red-200 bg-red-50 text-red-800"]
                : ["–", "border-stone-200 bg-stone-50 text-stone-400"];
        return (
          <span
            key={role}
            className={cx("whitespace-nowrap rounded-sm border px-1.5 py-px text-[11px] font-semibold", cls)}
            title={`${role}: ${a === "APPROVED" ? "approved" : a === "PENDING" ? "waiting" : a === "SENT_BACK" ? "sent back" : a === "REJECTED" ? "rejected" : "–"}`}
          >
            {role} {icon}
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

  return (
    <>
      <PageHeader
        eyebrow="01 / Orders"
        title="Orders &"
        emph="approvals"
        subtitle="The CFO checks the money and the COO checks the factory; both must approve."
        actions={can(viewer.role, ["BD_EXEC", "BD_HEAD"]) ? <ButtonLink href="/orders/new">+ New order</ButtonLink> : undefined}
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
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const count = f.statuses.length ? views.filter((v) => f.statuses.includes(v.order.status)).length : views.length;
          return (
            <Link
              key={f.key}
              href={`/orders?status=${f.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={cx("rounded-sm border px-2 py-1 text-xs font-medium", filter.key === f.key ? "border-stone-800 bg-stone-800 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50")}
            >
              {f.label} <span className="opacity-60">{count}</span>
            </Link>
          );
        })}
        <form className="ml-auto flex items-center gap-2">
          <input type="hidden" name="status" value={filter.key} />
          <input name="q" defaultValue={q} placeholder="Search customer or order…" className="w-56 rounded-sm border border-stone-300 bg-white px-2 py-1 text-xs" />
        </form>
        <ExportButton filename="sln-orders" rows={exportRows} />
      </div>

      {rows.length === 0 ? (
        <Empty>No orders here.</Empty>
      ) : (
        <div className={tbl.wrap}>
          <table className={tbl.table}>
            <thead>
              <tr>
                <th className={tbl.th}>Order</th>
                <th className={tbl.th}>Customer</th>
                <th className={tbl.th}>Salesperson</th>
                <th className={tbl.th}>Product</th>
                <th className={tbl.th}>Containers</th>
                <th className={tbl.thR}>Tonnes</th>
                <th className={tbl.th}>Ships</th>
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
                    <td className={cx(tbl.td, "whitespace-nowrap font-medium")}>{containerSummary(v.order.shipments)}</td>
                    <td className={tbl.tdR}>{v.totalMt.toLocaleString("en-IN")}</td>
                    <td className={cx(tbl.td, "whitespace-nowrap")}>
                      {monthLabel(v.firstMonth)}
                      {v.lastMonth !== v.firstMonth && ` – ${monthLabel(v.lastMonth)}`}
                    </td>
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
      <div className={tbl.wrap}>
        <table className={cx(tbl.table, "min-w-[980px]")}>
          <thead>
            <tr>
              <th className={tbl.th}>Order</th>
              <th className={tbl.thR}>Tonnes</th>
              <th className={tbl.thR}>Value</th>
              <th className={tbl.thR}>Margin</th>
              <th className={tbl.th}>Checks</th>
              <th className={tbl.th}>CFO</th>
              <th className={tbl.th}>COO</th>
              <th className={tbl.thR}>Waiting</th>
              <th className={tbl.thR}>Decision</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((q) => {
              const first = q.lines[0];
              const spills = q.issues.filter((i) => i.kind === "OVERBOOK");
              const matShort = shorts.filter((x) => x.orders.some((o) => o.orderId === q.order.id));
              const signable = q.approvals.filter((a) => a.status === "PENDING" && (role === "ALL" || a.role === role)).map((a) => a.role);
              const profitOk = q.margin.marginPct >= q.margin.targetPct;
              const checks = [
                { ok: !spills.length, label: spills.length ? `Line full ${spills.length} mo` : "Line space" },
                { ok: !matShort.length, label: matShort.length ? `${matShort.length} to buy` : "Materials" },
                { ok: q.order.gbPriceClosed, label: q.order.gbPriceClosed ? "Bean price fixed" : "Bean price open", soft: true },
              ];
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
                  <td className={tbl.td}>
                    <div className="flex flex-wrap gap-1">
                      {checks.map((c) => (
                        <span
                          key={c.label}
                          className={cx(
                            "whitespace-nowrap rounded-sm border px-1.5 py-px text-[11px] font-medium",
                            c.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : c.soft ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-800",
                          )}
                        >
                          {c.ok ? "✓" : c.soft ? "~" : "✕"} {c.label}
                        </span>
                      ))}
                    </div>
                  </td>
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

function Decision({ status }: { status?: string }) {
  if (!status) return null;
  const map: Record<string, [string, string]> = {
    PENDING: ["Waiting", "bg-amber-100 text-amber-900"],
    APPROVED: ["✓ Approved", "bg-emerald-100 text-emerald-800"],
    SENT_BACK: ["Sent back", "bg-sky-100 text-sky-800"],
    REJECTED: ["Rejected", "bg-red-100 text-red-800"],
  };
  const [label, cls] = map[status] ?? [status, ""];
  return <span className={cx("whitespace-nowrap rounded-sm px-1.5 py-px text-[11px] font-semibold", cls)}>{label}</span>;
}

function SellTab({ canCreate, view }: { canCreate: boolean; view: "product" | "code" | "pack" }) {
  const months = planHorizon(12);
  const state = loadCapacityState();
  const s = loadSettings();
  const packs = ["GLASS", "CAN"].map((pack) => ({ pack, months: Object.fromEntries(months.map((m) => [m, Math.max(0, (s[`pack_capacity.${pack}`] ?? 0) - packLoadAt(state, pack, m))])) }));
  const skus = activeSkus().map((k) => ({ code: k.code, productType: k.productType, blend: k.blend, packFormat: k.packFormat }));
  return <Sellable view={view} months={months} room={openRoom(months)} packs={packs} skus={skus} canCreate={canCreate} />;
}
