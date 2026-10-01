import Link from "next/link";
import { cx, Tabs } from "./ui";

export type PlanningTab = "calendar" | "daily" | "new" | "done" | "setup";

export function PlanningTabs({ active, toPlace }: { active: PlanningTab; toPlace?: number }) {
  return (
    <Tabs
      active={active === "daily" ? "calendar" : active}
      tabs={[
        { key: "calendar", href: "/plan", label: "Calendar" },
        { key: "new", href: "/plan?tab=new", label: "New orders", count: toPlace },
        { key: "done", href: "/plan?tab=done", label: "Production done" },
        { key: "setup", href: "/capacity", label: "Line setup" },
      ]}
    />
  );
}

// Under the Calendar tab: switch between the monthly plan and the daily shop-floor view.
export function CalendarViewSwitch({ view }: { view: "monthly" | "daily" }) {
  return (
    <div className="mb-4 inline-flex border border-stone-300 text-[13px]">
      {(
        [
          ["monthly", "/plan", "Monthly"],
          ["daily", "/plan?tab=daily", "Daily"],
        ] as const
      ).map(([k, href, label]) => (
        <Link key={k} href={href} className={cx("border-r border-stone-300 px-3 py-1 font-semibold last:border-r-0", view === k ? "bg-stone-900 text-white" : "text-stone-600 hover:text-stone-900")}>
          {label}
        </Link>
      ))}
    </div>
  );
}
