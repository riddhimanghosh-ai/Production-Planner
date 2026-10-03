"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { resetDemoData, setViewer } from "@/app/actions";
import { ROLE_LABELS, type Role } from "@/lib/domain";
import { cx } from "./ui";

type Item = { href: string; label: string; step?: string; also?: string[]; locked?: boolean };

// Sidebar: the three process steps first, then everything else.
const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Process",
    items: [
      { href: "/orders", label: "Orders & approvals", step: "01" },
      { href: "/plan", label: "Production calendar", step: "02", also: ["/capacity"] },
      { href: "/procurement", label: "Inventory & purchasing", step: "03" },
    ],
  },
  {
    label: "More",
    items: [
      { href: "/margins", label: "Profit & costs" },
      { href: "/summary", label: "Leadership summary", locked: true },
      { href: "/master", label: "Settings" },
      { href: "/d365", label: "D365 integration" },
      { href: "/demo", label: "Demo guide" },
    ],
  },
];

export function Nav({ approvalCount, alertCount }: { approvalCount: number; alertCount: number }) {
  const path = usePathname();
  return (
    <nav className="space-y-5">
      {GROUPS.map((g) => (
        <div key={g.label}>
          <div className="mb-1.5 px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-stone-400">{g.label}</div>
          <div className="space-y-px">
            {g.items.map((n) => {
              const active = [n.href, ...(n.also ?? [])].some((h) => path.startsWith(h));
              const badge = n.href === "/orders" ? approvalCount : n.href === "/procurement" ? alertCount : 0;
              if (n.locked)
                return (
                  <span
                    key={n.href}
                    title="Optional, not part of this prototype yet"
                    aria-disabled="true"
                    className="flex h-9 cursor-not-allowed select-none items-center gap-2.5 border-l-2 border-transparent px-3 text-[13px] font-medium text-stone-400"
                  >
                    <span className="flex-1 truncate">{n.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em]">Optional</span>
                  </span>
                );
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cx("flex h-9 items-center gap-2.5 border-l-2 px-3 text-[13px] font-medium transition-colors", active ? "border-brand-600 bg-white text-stone-900" : "border-transparent text-stone-600 hover:bg-white hover:text-stone-900")}
                >
                  {n.step && <span className={cx("w-5 shrink-0 font-mono text-[10px]", active ? "text-brand-600" : "text-stone-400")}>{n.step}</span>}
                  <span className="flex-1 truncate">{n.label}</span>
                  {badge > 0 && <span className={cx("font-mono text-[11px] font-medium", n.href === "/procurement" ? "text-red-700" : "text-stone-900")}>{badge}</span>}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function ViewerSwitcher({ current, users, inline }: { current: string; users: { id: number; name: string; role: Role }[]; inline?: boolean }) {
  const [pending, start] = useTransition();
  const select = (
    <select
      value={current}
      disabled={pending}
      onChange={(e) => start(() => setViewer(e.target.value))}
      className={cx("h-8 border border-stone-300 bg-white px-2 text-[13px] text-stone-900 outline-none focus:border-brand-600", inline ? "min-w-52" : "w-full")}
    >
      <option value="ALL" className="text-stone-900">
        All access (demo)
      </option>
      {users.map((u) => {
        // Roles only, except where a role has several people (the salespeople): then show the name too.
        const same = users.filter((x) => x.role === u.role);
        const label = same.length > 1 ? `${u.name}, ${ROLE_LABELS[u.role]}` : ROLE_LABELS[u.role];
        return (
          <option key={u.id} value={String(u.id)} className="text-stone-900">
            {label}
          </option>
        );
      })}
    </select>
  );
  if (inline)
    return (
      <label className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">Viewing as</span>
        {select}
      </label>
    );
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">Viewing as</span>
      {select}
    </label>
  );
}

export function ResetDemoButton() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (confirm("Reset all orders, approvals, capacity and costs back to the demo data?")) start(() => resetDemoData());
      }}
      className="h-8 border border-stone-300 bg-white px-2.5 text-[12px] text-stone-500 transition-colors hover:border-stone-900 hover:text-stone-900 disabled:opacity-50"
    >
      {pending ? "Resetting…" : "Reset demo data"}
    </button>
  );
}
