import Link from "next/link";
import { monthLabel, productLabel } from "@/lib/domain";
import type { RecommendedProduct } from "@/lib/recommend";
import { buttonClass, cx, tbl } from "./ui";

// For the salesperson: what leadership wants pushed right now, with room on the lines and the margin it earns.
export function RecommendedProducts({ items, months, canCreate }: { items: RecommendedProduct[]; months: string[]; canCreate: boolean }) {
  if (!items.length) return null;
  const push = items.filter((i) => i.priority === "HIGH");
  const avoid = items.filter((i) => i.priority === "LOW");
  const window = `${monthLabel(months[0], false)} to ${monthLabel(months[2], false)}`;
  return (
    <section className="mb-4">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-700">Recommended to sell</div>
        <div className="text-[12px] text-stone-500">Set by leadership in Settings, Products</div>
      </div>
      <div className={tbl.wrap}>
        <table className={cx(tbl.table, "min-w-[900px]")}>
          <thead>
            <tr>
              <th className={tbl.th}>Product</th>
              <th className={tbl.th}>Why</th>
              <th className={tbl.thR}>Room, {window}</th>
              <th className={tbl.thR}>Typical price</th>
              <th className={tbl.thR}>Margin</th>
              <th className={tbl.th} />
            </tr>
          </thead>
          <tbody>
            {[...push, ...avoid].map((r) => (
              <tr key={r.skuId} className={cx(tbl.tr, r.priority === "LOW" && "text-stone-500")}>
                <td className={cx(tbl.td, "whitespace-nowrap")}>
                  <span className={cx("mr-2 inline-block h-1.5 w-1.5 align-middle", r.priority === "HIGH" ? "bg-emerald-600" : "bg-red-600")} />
                  <span className="font-medium text-stone-900">{productLabel({ productType: r.productType, blend: r.blend, packFormat: r.packFormat })}</span>
                  <span className={cx("ml-2 font-mono text-[10px] uppercase tracking-[0.08em]", r.priority === "HIGH" ? "text-emerald-700" : "text-red-700")}>{r.priority === "HIGH" ? "Push" : "Avoid"}</span>
                </td>
                <td className={cx(tbl.td, "text-stone-600")}>{r.note || "–"}</td>
                <td className={cx(tbl.tdR, r.free3 < 5 ? "text-red-700" : "")}>{r.free3.toLocaleString("en-IN")} t</td>
                <td className={tbl.tdR}>
                  ₹{r.priceKg.toLocaleString("en-IN")}/kg
                  <div className="text-[11px] text-stone-400">{r.fromSales ? "our average" : "indicative"}</div>
                </td>
                <td className={cx(tbl.tdR, "font-semibold", r.marginPct >= 18 ? "text-emerald-700" : "text-red-700")}>
                  {r.marginPct.toFixed(1)}%<div className="text-[11px] font-normal text-stone-400">₹{Math.round(r.marginPerKg)}/kg</div>
                </td>
                <td className={cx(tbl.tdR, "whitespace-nowrap")}>
                  {canCreate && r.priority === "HIGH" && (
                    <Link href={`/orders/new?product=${r.productType}&blend=${r.blend}&pack=${r.packFormat}`} className={buttonClass("secondary", "sm")}>
                      New order
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
