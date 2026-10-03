import { InventoryBoard } from "@/components/inventory-board";
import { PageHeader, type StatItem } from "@/components/ui";
import { store } from "@/data/store";
import { planHorizon } from "@/lib/capacity";
import { can, coffeeShare, monthLabel, ORIGINS, type Origin } from "@/lib/domain";
import { inventoryProjection, shortages } from "@/lib/inventory";
import { describeMaterial } from "@/lib/procurement";
import { settingsRows } from "@/lib/queries";
import { getViewer } from "@/lib/role";
import { loadSettings } from "@/lib/settings";

export default async function InventoryPage() {
  const viewer = await getViewer();
  const st = store();
  const s = loadSettings();
  const months = planHorizon(18);
  const projection = inventoryProjection(months);
  const shorts = shortages(projection);

  const openRequests = st.purchaseRequests.filter((r) => r.status === "OPEN");
  const attention = [
    ...openRequests.map((r) => {
      const row = projection.find((p) => p.key === r.materialKey);
      return {
        id: `req-${r.id}`,
        requestId: r.id,
        key: r.materialKey,
        name: row?.name ?? describeMaterial(r.materialKey).name,
        unit: row?.unit ?? describeMaterial(r.materialKey).unit,
        month: r.neededBy,
        quantity: r.quantity,
        earliestArrival: row?.earliestArrival ?? r.neededBy,
        leadDays: row?.leadDays ?? 0,
        source: `Asked by ${r.raisedBy}${r.note ? `, ${r.note}` : ""}`,
        orders: [] as { ref: string; customer: string; orderId: number }[],
      };
    }),
    ...shorts
      .filter((x) => !openRequests.some((r) => r.materialKey === x.key && r.neededBy === x.month))
      .map((x) => ({
        id: `short-${x.key}-${x.month}`,
        requestId: null,
        key: x.key,
        name: x.name,
        unit: x.unit,
        month: x.month,
        quantity: Math.ceil(x.short),
        earliestArrival: x.earliestArrival,
        leadDays: x.leadDays,
        source: "Found automatically from the production plan",
        orders: [...new Map(x.orders.map((o) => [o.orderId, { ref: o.ref, customer: o.customer, orderId: o.orderId }])).values()],
      })),
  ].sort((a, b) => a.month.localeCompare(b.month));

  const suppliers: Record<string, string> = { VIETNAM: "Dak Lak Coffee Exports", BRAZIL: "Minas Gerais Traders", INDIA: "Coorg Estates" };
  const supplierFor = (key: string) => (key.startsWith("GB|") ? suppliers[key.split("|")[1]] : key === "CHICORY" ? "Gujarat Chicory Co." : key.startsWith("CAN|") ? "Mumbai Can Co." : "Pune Packaging");

  const openGb = st.orders
    .filter((o) => ["PENDING_APPROVAL", "COMMITTED", "SENT_BACK"].includes(o.status) && !o.gbPriceClosed)
    .map((o) => {
      const ols = st.orderLines.filter((l) => l.orderId === o.id);
      const beanKg = ols.reduce((sum, l) => {
        const sku = st.skus.find((x) => x.id === l.skuId)!;
        return sum + l.quantityMt * 1000 * coffeeShare(sku.blend, l.chicoryPct) * s[`yield.${sku.productType}`];
      }, 0);
      const firstMonth = st.allocations.filter((a) => a.orderId === o.id).reduce((m, a) => (a.month < m ? a.month : m), ols[0]?.month ?? "");
      return {
        orderId: o.id,
        ref: o.ref,
        customer: st.customers.find((c) => c.id === o.customerId)?.name ?? "",
        origin: ORIGINS[o.beanOrigin as Origin],
        grade: o.gbGrade,
        market: s[`bean_price.${o.beanOrigin}`],
        beanT: beanKg / 1000,
        firstMonth,
        approved: o.status === "COMMITTED",
      };
    })
    .sort((a, b) => a.firstMonth.localeCompare(b.firstMonth));

  const pos = st.purchaseOrders.filter((p) => p.status === "ORDERED").sort((a, b) => a.arrivalMonth.localeCompare(b.arrivalMonth));
  const shortKeys = new Set(shorts.map((x) => x.key)).size;
  const stats: StatItem[] = [
    { label: "Materials short", value: shortKeys, hint: shortKeys ? "Not covered by stock or purchases" : "Plan is covered", tone: shortKeys ? "red" : "green" },
    { label: "To buy now", value: attention.length, hint: attention[0] ? `Most urgent: ${attention[0].name}` : "Nothing to buy" },
    { label: "Purchases on the way", value: pos.length, hint: pos[0] ? `Next arrives ${monthLabel(pos[0].arrivalMonth)}` : "None open" },
    { label: "Bean price not fixed", value: openGb.length, hint: openGb.length ? "Orders still at market price" : "All orders fixed" },
  ];

  return (
    <>
      <PageHeader eyebrow="03 / Materials" title="Inventory &" emph="purchasing" subtitle="Stock, purchases on the way, and what the plan still needs." stats={stats} />
      <InventoryBoard
        months={months}
        rows={projection.map((r) => ({
          key: r.key,
          group: r.group,
          name: r.name,
          unit: r.unit,
          onHand: r.onHand,
          onOrder: r.onOrder,
          leadDays: r.leadDays,
          cells: Object.fromEntries(
            months.map((m) => {
              const c = r.cells[m];
              return [
                m,
                {
                  need: c.need,
                  arriving: c.arriving,
                  available: c.available,
                  balanceAfter: c.balanceAfter,
                  short: c.short,
                  orders: c.orders.map((o) => ({ ...o, line: st.lines.find((l) => l.id === o.lineId)?.code ?? "" })),
                  pos: st.purchaseOrders.filter((p) => p.materialKey === r.key && p.status === "ORDERED" && p.arrivalMonth === m).map((p) => ({ id: p.id, quantity: p.quantity, supplier: p.supplier })),
                },
              ];
            }),
          ),
        }))}
        attention={attention.map((a) => ({ ...a, supplier: supplierFor(a.key) }))}
        purchaseOrders={st.purchaseOrders
          .filter((p) => p.status === "ORDERED")
          .sort((a, b) => a.arrivalMonth.localeCompare(b.arrivalMonth))
          .map((p) => ({
            id: p.id,
            name: projection.find((r) => r.key === p.materialKey)?.name ?? describeMaterial(p.materialKey).name,
            unit: describeMaterial(p.materialKey).unit,
            quantity: p.quantity,
            arrivalMonth: p.arrivalMonth,
            supplier: p.supplier,
          }))}
        openGb={openGb}
        beanPrices={settingsRows()
          .filter((r) => r.key.startsWith("bean_price."))
          .map((r) => ({ key: r.key, value: r.value }))}
        canBuy={can(viewer.role, ["PROCUREMENT", "COO"])}
        canPrice={can(viewer.role, ["PROCUREMENT", "COO", "CFO", "ADMIN"])}
      />
    </>
  );
}
