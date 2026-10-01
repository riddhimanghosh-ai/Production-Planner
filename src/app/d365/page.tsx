import { cx, PageHeader, tbl } from "@/components/ui";

// How the tool would connect to Microsoft Dynamics 365 later. Static explainer for demos; nothing here talks to D365 yet.
const FLOWS = [
  { what: "Stock on hand (beans, chicory, jars, cans, labels)", toErp: false, why: "Pulling on-hand inventory from D365 Supply Chain Management makes “Stock & coverage” and “Needs attention” trustworthy." },
  { what: "Purchase orders", toErp: true, why: "“Place order” would create the purchase order in D365, and the product receipt posted in D365 would mark it received here." },
  { what: "Approved customer orders", toErp: true, why: "Once the CFO and COO approve, create the sales order in D365 for invoicing, export documents and dispatch." },
  { what: "Daily production output", toErp: true, why: "“Close the day” tonnes reported as finished against the production order in D365, so costing and stock update." },
  { what: "Master data (customers, products, suppliers)", toErp: false, why: "One source of truth instead of keeping lists in two places." },
  { what: "Payments and credit", toErp: false, why: "Customer balances and credit limits from D365 Finance shown to the CFO at approval, to judge credit risk." },
];

export default function D365Page() {
  return (
    <>
      <PageHeader eyebrow="Integration" title="How it connects to" emph="Dynamics 365" />
      <div className={tbl.wrap}>
        <table className={cx(tbl.table, "min-w-[760px]")}>
          <thead>
            <tr>
              <th className={tbl.th}>What</th>
              <th className={tbl.th}>Direction</th>
              <th className={tbl.th}>Why</th>
            </tr>
          </thead>
          <tbody>
            {FLOWS.map((f) => (
              <tr key={f.what} className={cx(tbl.tr, "align-top")}>
                <td className={cx(tbl.td, "font-medium text-stone-900")}>{f.what}</td>
                <td className={cx(tbl.td, "whitespace-nowrap font-semibold", f.toErp ? "text-brand-600" : "text-stone-900")}>{f.toErp ? "Tool → D365" : "D365 → Tool"}</td>
                <td className={cx(tbl.td, "text-stone-700")}>{f.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 max-w-3xl text-[12px] text-stone-500">Connected through D365&apos;s standard data entities (OData APIs). Nothing is connected in this prototype.</p>
    </>
  );
}
