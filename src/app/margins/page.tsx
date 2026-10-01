import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { MarginCalculator } from "@/components/margin-calculator";
import { CostRatesForm } from "@/components/cost-rates-form";
import { Card, cx, PageHeader, Pager, Stat, StatStrip, Tabs, tbl } from "@/components/ui";
import { can, formatInr, formatPerKg, monthLabel, ORDER_STATUS, PRODUCT_TYPES, productLabel, type OrderStatus } from "@/lib/domain";
import { computeMargin } from "@/lib/margin";
import { listOrderViews } from "@/lib/queries";
import { getViewer } from "@/lib/role";
import { loadSettings } from "@/lib/settings";
import { withShare } from "@/lib/workflow";

const TABS = [
  { key: "calculator", label: "Price a quote" },
  { key: "orders", label: "Profit on our orders" },
  { key: "norms", label: "Cost rates" },
];

export default async function MarginsPage({ searchParams }: PageProps<"/margins">) {
  const { tab = "calculator", page = "1" } = await searchParams;
  const viewer = await getViewer();
  const s = loadSettings();

  return (
    <>
      <PageHeader eyebrow="Finance" title="Profit &" emph="costs" />
      <Tabs active={String(tab)} tabs={TABS.map((t) => ({ ...t, href: `/margins?tab=${t.key}` }))} />
      {tab === "orders" ? <ByLine viewer={viewer} page={Number(page) || 1} /> : tab === "norms" ? <Norms viewerRole={viewer.role} /> : <MarginCalculator settings={s} products={Object.keys(PRODUCT_TYPES)} />}
    </>
  );
}

const PAGE_SIZE = 15;

function ByLine({ viewer, page }: { viewer: Awaited<ReturnType<typeof getViewer>>; page: number }) {
  const s = loadSettings();
  const target = s["margin.target_pct"];
  const rows = listOrderViews(viewer)
    .filter((v) => v.commercials && !["REJECTED", "CANCELLED"].includes(v.order.status))
    .flatMap((v) =>
      v.lines.map((l) => {
        const today = computeMargin(
          {
            sku: withShare(l.sku, l.chicoryPct),
            quantityMt: l.quantityMt,
            pricePerKg: l.pricePerKg,
            currency: v.order.currency,
            beanOrigin: v.order.beanOrigin,
            gbClosedPrice: v.order.gbPriceClosed ? v.order.gbClosedPrice : null,
            freightBasis: v.order.freightBasis,
            advancePct: v.order.advancePct,
            creditDays: v.order.creditDays,
          },
          s,
        );
        return { v, l, snap: v.snapshot?.byLine?.[l.id] ?? null, today };
      }),
    );
  const committed = rows.filter((r) => r.v.order.status === "COMMITTED");
  const revenue = committed.reduce((a, r) => a + (r.snap ?? r.today).revenue, 0);
  const approvedMargin = committed.reduce((a, r) => a + (r.snap ?? r.today).totalMargin, 0);
  const below = rows.filter((r) => r.today.marginPct < target);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);

  const exportRows = [
    ["Order", "Status", "Customer", "Product", "Month", "Tonnes", "Price (INR/kg)", "Cost today (INR/kg)", "Profit (INR/kg)", "Margin when priced %", "Margin today %", "Total profit (INR)", "Bean price"],
    ...rows.map(({ v, l, snap, today }) => [
      v.order.ref,
      ORDER_STATUS[v.order.status as OrderStatus],
      v.customer.name,
      productLabel(l.sku, l.chicoryPct),
      monthLabel(l.month),
      l.quantityMt,
      Math.round(today.priceInrPerKg),
      Math.round(today.costPerKg),
      Math.round(today.marginPerKg),
      snap ? snap.marginPct.toFixed(1) : "",
      today.marginPct.toFixed(1),
      Math.round(today.totalMargin),
      v.order.gbPriceClosed ? `fixed ${v.order.gbClosedPrice}` : "market",
    ]),
  ];

  return (
    <>
      <StatStrip>
        <Stat label="Approved sales" value={formatInr(revenue)} />
        <Stat label="Approved profit" value={formatInr(approvedMargin)} hint={revenue ? `${((approvedMargin / revenue) * 100).toFixed(1)}%` : undefined} />
        <Stat label="Below CFO minimum" value={below.length} tone={below.length ? "red" : "green"} />
      </StatStrip>

      <Card className="mt-3" title="Profit by order line" flush actions={<ExportButton filename="sln-margins" rows={exportRows} />}>
        <div className="overflow-x-auto">
          <table className={cx(tbl.table, "min-w-[860px]")}>
            <thead>
              <tr>
                <th className={tbl.th}>Customer</th>
                <th className={tbl.th}>Product</th>
                <th className={tbl.th}>Month</th>
                <th className={tbl.thR}>Tonnes</th>
                <th className={tbl.thR}>Price / kg</th>
                <th className={tbl.thR}>Profit / kg</th>
                <th className={tbl.thR}>Margin</th>
                <th className={tbl.thR}>Total profit</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map(({ v, l, today }) => (
                <tr key={l.id} className={cx(tbl.tr, today.marginPct < target && "bg-red-50/50")}>
                  <td className={cx(tbl.td, "whitespace-nowrap")}>
                    <Link href={`/orders/${v.order.id}`} className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
                      {v.customer.name}
                    </Link>
                  </td>
                  <td className={tbl.td}>{productLabel(l.sku, l.chicoryPct)}</td>
                  <td className={cx(tbl.td, "whitespace-nowrap")}>{monthLabel(l.month)}</td>
                  <td className={tbl.tdR}>{l.quantityMt}</td>
                  <td className={tbl.tdR}>{formatPerKg(today.priceInrPerKg)}</td>
                  <td className={tbl.tdR}>{formatPerKg(today.marginPerKg)}</td>
                  <td className={cx(tbl.tdR, "font-semibold", today.marginPct < target ? "text-red-700" : "text-emerald-700")}>{today.marginPct.toFixed(1)}%</td>
                  <td className={tbl.tdR}>{formatInr(today.totalMargin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={current} pages={pages} total={rows.length} href={(p) => `/margins?tab=orders&page=${p}`} />
      </Card>
    </>
  );
}

function Norms({ viewerRole }: { viewerRole: Awaited<ReturnType<typeof getViewer>>["role"] }) {
  return <CostRatesForm values={loadSettings()} editable={can(viewerRole, ["CFO", "COO", "ADMIN"])} />;
}
