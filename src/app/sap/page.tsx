import { cx, PageHeader, tbl } from "@/components/ui";

// How the tool would connect to SAP later. Static explainer for demos; nothing here talks to SAP yet.
const FLOWS = [
  { what: "Stock on hand (beans, chicory, jars, cans, labels)", toSap: false, why: "Pulling it from SAP inventory makes “Stock & coverage” and “Needs attention” trustworthy." },
  { what: "Purchase orders", toSap: true, why: "“Place order” would create the PO in SAP (the MM module), and goods receipt in SAP would mark it received here." },
  { what: "Approved customer orders", toSap: true, why: "Once the CFO and COO approve, create the sales order in SAP for invoicing and dispatch." },
  { what: "Daily production output", toSap: true, why: "“Close the day” tonnes posted as production confirmations (the PP module), so costing and stock update." },
  { what: "Master data (customers, product codes, suppliers)", toSap: false, why: "One source of truth instead of keeping lists in two places." },
  { what: "Payments and credit", toSap: false, why: "Overdue invoices shown to the CFO at approval, to judge credit risk." },
];

export default function SapPage() {
  return (
    <>
      <PageHeader eyebrow="Integration" title="How it connects to" emph="SAP" />
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
                <td className={cx(tbl.td, "whitespace-nowrap font-semibold", f.toSap ? "text-brand-600" : "text-stone-900")}>{f.toSap ? "Tool → SAP" : "SAP → Tool"}</td>
                <td className={cx(tbl.td, "text-stone-700")}>{f.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
