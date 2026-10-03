import { Segmented, Tabs } from "./ui";

export type PlanningTab = "today" | "calendar" | "daily" | "new" | "done" | "quality" | "setup";

export function PlanningTabs({ active, toPlace }: { active: PlanningTab; toPlace?: number }) {
  return (
    <Tabs
      active={active === "daily" ? "calendar" : active}
      tabs={[
        { key: "today", href: "/plan?tab=today", label: "Today" },
        { key: "calendar", href: "/plan", label: "Calendar" },
        { key: "new", href: "/plan?tab=new", label: "New orders", count: toPlace },
        { key: "done", href: "/plan?tab=done", label: "Production done" },
        { key: "quality", href: "/plan?tab=quality", label: "Line quality" },
        { key: "setup", href: "/capacity", label: "Line setup" },
      ]}
    />
  );
}

// Under the Calendar tab: switch between the monthly plan and the daily shop-floor view.
export function CalendarViewSwitch({ view }: { view: "monthly" | "daily" }) {
  return (
    <Segmented
      className="mb-4"
      active={view}
      items={[
        { key: "monthly", href: "/plan", label: "Monthly" },
        { key: "daily", href: "/plan?tab=daily", label: "Daily" },
      ]}
    />
  );
}
