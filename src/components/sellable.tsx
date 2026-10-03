import Link from "next/link";
import { monthLabel, PACK_FORMATS, PRODUCT_HINTS, PRODUCT_TYPES, type PackFormat, type ProductType } from "@/lib/domain";
import type { OpenRoom } from "@/lib/recommend";
import { cx, tbl } from "./ui";

export type PackRoom = { pack: string; months: Record<string, number> };

const t = (n: number) => `${Math.floor(n).toLocaleString("en-IN")} t`;

// Sales view: how many tonnes we can still sell, month by month, before starting an order.
export type SellSku = { code: string; productType: string; blend: string; packFormat: string };

export function Sellable({ view, months, room, packs, skus, canCreate }: { view: "product" | "code" | "pack"; months: string[]; room: OpenRoom[]; packs: PackRoom[]; skus: SellSku[]; canCreate: boolean }) {
  // Per product code: line space for its product, capped by the filling limit of its pack.
  const freeFor = (k: SellSku, m: string) => {
    const line = room.find((r) => r.productType === k.productType);
    if (!line?.lines.length) return null;
    const pack = packs.find((p) => p.pack === k.packFormat);
    return Math.min(line.months[m]?.free ?? 0, pack ? (pack.months[m] ?? 0) : Infinity);
  };
  const views = [
    ["code", "By product code"],
    ["product", "By product"],
    ["pack", "Packing limit"],
  ] as const;
  return (
    <div className="space-y-4">
      <div className="inline-flex border border-stone-300 text-[13px]">
        {views.map(([k, label]) => (
          <Link key={k} href={`/orders?tab=sell&view=${k}`} className={cx("border-r border-stone-300 px-3 py-1 font-semibold last:border-r-0", view === k ? "bg-stone-900 text-white" : "text-stone-600 hover:text-stone-900")}>
            {label}
          </Link>
        ))}
      </div>
      {view === "product" && (
        <section>
          <div className={tbl.wrap}>
            <table className={cx(tbl.table, "min-w-[980px]")}>
              <thead>
                <tr>
                  <th className={tbl.th}>Product</th>
                  {months.map((m) => (
                    <th key={m} className={tbl.thR}>
                      {monthLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {room.map((r) => (
                  <tr key={r.productType}>
                    <td className={cx(tbl.td, "whitespace-nowrap")} title={PRODUCT_HINTS[r.productType as ProductType]}>
                      <div className="font-medium text-stone-900">{PRODUCT_TYPES[r.productType as ProductType]}</div>
                      <div className="text-[11px] text-stone-500">{r.lines.length ? r.lines.join(", ") : "No line makes it yet"}</div>
                    </td>
                    {months.map((m) => {
                      const free = r.months[m]?.free ?? 0;
                      if (!r.lines.length)
                        return (
                          <td key={m} className={cx(tbl.tdR, "text-stone-300")}>
                            –
                          </td>
                        );
                      const label = free < 1 ? "Full" : t(free);
                      const cls = free < 1 ? "bg-stone-50 text-stone-400" : free < 10 ? "text-stone-900" : "font-semibold text-emerald-700";
                      return (
                        <td key={m} className={cx(tbl.tdR, cls)}>
                          {canCreate && free >= 1 ? (
                            <Link
                              href={`/orders/new?product=${r.productType}&from=${m}`}
                              className="underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600"
                              title={`Start an order for ${PRODUCT_TYPES[r.productType as ProductType]} in ${monthLabel(m)}`}
                            >
                              {label}
                            </Link>
                          ) : (
                            label
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {view === "code" && (
        <section>
          <div className={tbl.wrap}>
            <table className={cx(tbl.table, "min-w-[980px]")}>
              <thead>
                <tr>
                  <th className={tbl.th}>Product code</th>
                  {months.map((m) => (
                    <th key={m} className={tbl.thR}>
                      {monthLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {skus.map((k) => (
                  <tr key={k.code}>
                    <td className={cx(tbl.td, "whitespace-nowrap font-medium text-stone-900")}>{k.code}</td>
                    {months.map((m) => {
                      const free = freeFor(k, m);
                      if (free == null)
                        return (
                          <td key={m} className={cx(tbl.tdR, "text-stone-300")}>
                            –
                          </td>
                        );
                      const label = free < 1 ? "Full" : t(free);
                      return (
                        <td key={m} className={cx(tbl.tdR, free < 1 ? "bg-stone-50 text-stone-400" : free < 10 ? "text-stone-900" : "font-semibold text-emerald-700")}>
                          {canCreate && free >= 1 ? (
                            <Link
                              href={`/orders/new?product=${k.productType}&blend=${k.blend}&pack=${k.packFormat}&from=${m}`}
                              className="underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600"
                              title={`Start an order for ${k.code} in ${monthLabel(m)}`}
                            >
                              {label}
                            </Link>
                          ) : (
                            label
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {view === "pack" && (
        <section>
          <div className={tbl.wrap}>
            <table className={cx(tbl.table, "min-w-[980px]")}>
              <thead>
                <tr>
                  <th className={tbl.th}>Pack</th>
                  {months.map((m) => (
                    <th key={m} className={tbl.thR}>
                      {monthLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={tbl.td}>{PACK_FORMATS.BULK}</td>
                  <td colSpan={months.length} className={cx(tbl.td, "text-stone-500")}>
                    No separate limit, only line space above
                  </td>
                </tr>
                {packs.map((p) => (
                  <tr key={p.pack}>
                    <td className={cx(tbl.td, "whitespace-nowrap")}>{PACK_FORMATS[p.pack as PackFormat]}</td>
                    {months.map((m) => {
                      const free = p.months[m] ?? 0;
                      return (
                        <td key={m} className={cx(tbl.tdR, free < 1 ? "bg-stone-50 text-stone-400" : "text-stone-900")}>
                          {free < 1 ? "Full" : t(free)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="max-w-3xl text-[13px] text-stone-500">
        Tonnes are what is still free after approved orders and orders waiting for approval. Spray-dried and Agglomerated share SD01 and SD02, so selling one uses up space for the other. Jars and cans must also fit the filling limit, so a product
        code shows the smaller of the two. Codes share the same space: selling one reduces the others. Click a figure to start an order for that product and month.
      </p>
    </div>
  );
}
