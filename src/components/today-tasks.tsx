import Link from "next/link";
import { buttonClass, cx, tbl } from "./ui";

export type Task = { kind: "start" | "close" | "qc" | "place" | "carry" | "buy" | "quality"; title: string; detail: string; href: string; action: string; urgent?: boolean };

// The planner's list for today, built from the live data. Each row has one thing to do and a button that opens it.
export function TodayTasks({ tasks }: { tasks: Task[] }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-700">Today&apos;s tasks</div>
        <div className="text-[12px] text-stone-500">{tasks.length === 0 ? "Nothing waiting" : `${tasks.length} to do${tasks.some((t) => t.urgent) ? `, ${tasks.filter((t) => t.urgent).length} urgent` : ""}`}</div>
      </div>
      {tasks.length === 0 ? (
        <p className="border border-stone-300 bg-stone-50 p-3 text-[13px] text-emerald-700">All lines started, nothing to close, no lots waiting and no orders to place.</p>
      ) : (
        <div className={tbl.wrap}>
          <table className={tbl.table}>
            <tbody>
              {tasks.map((t, i) => (
                <tr key={i} className={cx(tbl.tr, t.urgent && "bg-red-50/40")}>
                  <td className={cx(tbl.td, "w-8 font-mono text-[11px] text-stone-400")}>{String(i + 1).padStart(2, "0")}</td>
                  <td className={tbl.td}>
                    <div className={cx("font-medium", t.urgent ? "text-red-700" : "text-stone-900")}>{t.title}</div>
                    <div className="text-[12px] text-stone-500">{t.detail}</div>
                  </td>
                  <td className={cx(tbl.td, "whitespace-nowrap text-right")}>
                    <Link href={t.href} className={buttonClass(t.urgent ? "primary" : "secondary", "sm")}>
                      {t.action}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
