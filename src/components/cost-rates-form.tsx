"use client";

import { useActionState } from "react";
import { saveSettings } from "@/app/actions";
import { BEAN_GRADES, beanPriceKey, ORIGINS, PACK_FORMATS, PRODUCT_TYPES, type Origin } from "@/lib/domain";
import { buttonClass, cx, tbl } from "./ui";

type Values = Record<string, number>;

// Cost rates laid out as small grids (by origin, by product, by pack) instead of one long list.
export function CostRatesForm({ values, editable }: { values: Values; editable: boolean }) {
  const [state, action, pending] = useActionState(saveSettings, {});
  const field = (k: string) => <input name={k} type="number" step="any" min="0" defaultValue={values[k]} disabled={!editable} className={cx(tbl.input, "w-24 text-right")} aria-label={k} />;

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <Grid title="Green beans, by origin and grade" cols={["Origin", "Grade", "Market price ₹/kg"]}>
          {Object.entries(ORIGINS).flatMap(([k, name]) =>
            BEAN_GRADES[k as Origin].map((g, i) => (
              <tr key={`${k}-${g}`}>
                <td className={cx(tbl.td, i > 0 && "text-stone-400")}>{i === 0 ? name : ""}</td>
                <td className={tbl.td}>{g}</td>
                <td className={tbl.tdR}>{field(beanPriceKey(k, g))}</td>
              </tr>
            )),
          )}
        </Grid>

        <Grid title="By product" cols={["Product", "Beans per kg (kg)", "Making cost ₹/kg"]}>
          {Object.entries(PRODUCT_TYPES).map(([k, name]) => (
            <tr key={k}>
              <td className={tbl.td}>{name}</td>
              <td className={tbl.tdR}>{field(`yield.${k}`)}</td>
              <td className={tbl.tdR}>{field(`conversion.${k}`)}</td>
            </tr>
          ))}
        </Grid>

        <Grid title="Packing" cols={["Pack", "₹/kg"]}>
          {Object.entries(PACK_FORMATS).map(([k, name]) => (
            <tr key={k}>
              <td className={tbl.td}>{name}</td>
              <td className={tbl.tdR}>{field(`packaging.${k}`)}</td>
            </tr>
          ))}
        </Grid>

        <Grid title="Chicory" cols={["Item", "Value"]}>
          <Row label="Root price" unit="₹/kg">
            {field("chicory.price")}
          </Row>
          <Row label="Root per kg of chicory" unit="kg">
            {field("chicory.yield")}
          </Row>
        </Grid>

        <Grid title="Freight, currency & credit" cols={["Item", "Value"]}>
          <Row label="Freight, we deliver" unit="₹/kg">
            {field("logistics.per_kg")}
          </Row>
          <Row label="Paperwork, customer collects" unit="₹/kg">
            {field("logistics.docs_per_kg")}
          </Row>
          <Row label="Dollar rate" unit="₹/$">
            {field("fx.usd_inr")}
          </Row>
          <Row label="Credit cost per 30 days" unit="% of price">
            {field("finance.cost_pct_30d")}
          </Row>
        </Grid>

        <Grid title="Approval rules" cols={["Rule", "Value"]}>
          <Row label="CFO minimum margin" unit="%">
            {field("margin.target_pct")}
          </Row>
          <Row label="Flag credit longer than" unit="days">
            {field("approval.cfo_credit_days")}
          </Row>
        </Grid>
      </div>

      {editable && (
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className={buttonClass("primary")}>
            {pending ? "Saving…" : "Save changes"}
          </button>
          {state.message && <span className="text-[13px] text-stone-600">{state.message}</span>}
        </div>
      )}
    </form>
  );
}

function Grid({ title, cols, children }: { title: string; cols: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-stone-300 bg-white">
      <table className="tabular w-full text-[13px]">
        <thead>
          <tr>
            <th colSpan={cols.length} className={cx(tbl.th, "bg-stone-200 text-stone-800")}>
              {title}
            </th>
          </tr>
          <tr>
            {cols.map((c, i) => (
              <th key={c} className={i === 0 ? tbl.th : tbl.thR}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Row({ label, unit, children }: { label: string; unit: string; children: React.ReactNode }) {
  return (
    <tr>
      <td className={tbl.td}>
        {label} <span className="text-[11px] text-stone-400">{unit}</span>
      </td>
      <td className={tbl.tdR}>{children}</td>
    </tr>
  );
}
