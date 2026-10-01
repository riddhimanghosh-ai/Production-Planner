"use client";

import { useActionState } from "react";
import { saveSettings } from "@/app/actions";
import { buttonClass, Card, cx, tbl } from "./ui";

type Row = { key: string; value: number; label: string; unit: string; grp: string };

export function SettingsForm({ groups, editable }: { groups: [string, Row[]][]; editable: boolean }) {
  const [state, action, pending] = useActionState(saveSettings, {});
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        {groups.map(([grp, rows]) => (
          <Card key={grp} title={grp} flush>
            <table className={tbl.table}>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={tbl.tr}>
                    <td className={cx(tbl.td, "text-stone-700")}>{r.label}</td>
                    <td className={cx(tbl.td, "w-28")}>
                      <input name={r.key} type="number" step="any" min="0" defaultValue={r.value} disabled={!editable} className={cx(tbl.input, "w-full text-right")} aria-label={r.label} />
                    </td>
                    <td className={cx(tbl.td, "w-20 text-[11px] text-stone-500")}>{r.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>
      {editable && (
        <div className="sticky bottom-2 flex items-center gap-3 rounded-md border border-stone-300 bg-white px-3 py-2">
          <button type="submit" disabled={pending} className={buttonClass("primary")}>
            {pending ? "Saving…" : "Save changes"}
          </button>
          {state.message && <span className="text-[13px] text-stone-600">{state.message}</span>}
        </div>
      )}
    </form>
  );
}
