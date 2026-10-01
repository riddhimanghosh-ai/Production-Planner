"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { resetDemoData, setViewer } from "@/app/actions";
import { ROLE_LABELS, type Role } from "@/lib/domain";
import { cx } from "./ui";

const NAV = [
  { href: "/orders", label: "Orders & approvals", step: "1", also: [] as string[] },
  { href: "/plan", label: "Production calendar", step: "2", also: ["/capacity"] },
  { href: "/procurement", label: "Inventory & purchasing", step: "3", also: [] },
  { href: "/margins", label: "Profit & costs", step: "", also: [] },
  { href: "/summary", label: "Leadership summary", step: "", also: [], locked: true },
  { href: "/master", label: "Settings", step: "", also: [] },
  { href: "/d365", label: "D365 integration", step: "", also: [] },
  { href: "/demo", label: "Demo guide", step: "", also: [] },
];

export function Nav({ approvalCount, alertCount, canCreate }: { approvalCount: number; alertCount: number; canCreate: boolean }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col">
      {canCreate && (
        <Link
          href="/orders/new"
          className={cx("mb-4 hidden items-center justify-center gap-2 border px-2 py-1.5 text-[13px] font-medium transition-colors md:flex", path === "/orders/new" ? "border-brand-600 bg-brand-600 text-white" : "border-stone-900 bg-stone-900 text-white hover:border-brand-600 hover:bg-brand-600")}
        >
          + New order
        </Link>
      )}
      {NAV.map((n, i) => {
        const active = !path.startsWith("/orders/new") && [n.href, ...n.also].some((h) => path.startsWith(h));
        const badge = n.href === "/orders" ? approvalCount : n.href === "/procurement" ? alertCount : 0;
        return (
          <div key={n.href}>
            {i === 3 && <div className="my-3 hidden border-t border-stone-300 md:block" />}
            {"locked" in n && n.locked ? (
              <span title="Optional, not part of this prototype yet" aria-disabled="true" className="flex cursor-not-allowed select-none items-center gap-2 whitespace-nowrap border-l-2 border-transparent px-2 py-1.5 text-[13px] font-medium text-stone-400">
                <span className="w-5 shrink-0" />
                <span className="flex-1">{n.label}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-stone-400">Optional</span>
              </span>
            ) : (
              <Link href={n.href} className={cx("flex items-center gap-2 whitespace-nowrap border-l-2 px-2 py-1.5 text-[13px] font-medium transition-colors", active ? "border-brand-600 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-900")}>
                {n.step ? <span className={cx("w-5 shrink-0 font-mono text-[10px]", active ? "text-brand-600" : "text-stone-400")}>0{n.step}</span> : <span className="w-5 shrink-0" />}
                <span className="flex-1">{n.label}</span>
                {badge > 0 && <span className={cx("font-mono text-[11px]", n.href === "/procurement" ? "text-red-700" : "text-stone-900")}>{badge}</span>}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function ViewerSwitcher({ current, users }: { current: string; users: { id: number; name: string; role: Role }[] }) {
  const [pending, start] = useTransition();
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">Viewing as</span>
      <select value={current} disabled={pending} onChange={(e) => start(() => setViewer(e.target.value))} className="w-full border border-stone-300 bg-white px-2 py-1 text-[13px] text-stone-900 outline-none focus:border-brand-600">
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
      className="mt-2 w-full border border-stone-300 px-2 py-1 text-[11px] text-stone-500 hover:border-stone-900 hover:text-stone-900 disabled:opacity-50"
    >
      {pending ? "Resetting…" : "Reset demo data"}
    </button>
  );
}
