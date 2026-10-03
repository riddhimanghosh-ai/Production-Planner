"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cx } from "./ui";

// Phone navigation: a fixed bottom bar with the three process steps, plus "More" for the rest.
const MAIN = [
  { href: "/orders", label: "Orders", also: [] as string[] },
  { href: "/plan", label: "Calendar", also: ["/capacity"] },
  { href: "/procurement", label: "Inventory", also: [] },
];
const MORE = [
  { href: "/margins", label: "Profit & costs" },
  { href: "/master", label: "Settings" },
  { href: "/d365", label: "D365 integration" },
  { href: "/demo", label: "Demo guide" },
];

export function MobileNav({ approvalCount, alertCount }: { approvalCount: number; alertCount: number }) {
  const path = usePathname();
  const [more, setMore] = useState(false);
  const inMore = MORE.some((m) => path.startsWith(m.href));
  const item = "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium";
  return (
    <>
      {more && <div className="fixed inset-0 z-30 bg-black/20 md:hidden" onClick={() => setMore(false)} />}
      {more && (
        <div className="fixed inset-x-0 bottom-14 z-40 border-t border-stone-300 bg-white md:hidden">
          {MORE.map((m) => (
            <Link key={m.href} href={m.href} onClick={() => setMore(false)} className={cx("block border-b border-stone-200 px-4 py-3 text-[14px] font-medium last:border-0", path.startsWith(m.href) ? "text-stone-900" : "text-stone-600")}>
              {m.label}
            </Link>
          ))}
        </div>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-stone-300 bg-white md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {MAIN.map((n) => {
          const active = [n.href, ...n.also].some((h) => path.startsWith(h));
          const badge = n.href === "/orders" ? approvalCount : n.href === "/procurement" ? alertCount : 0;
          return (
            <Link key={n.href} href={n.href} onClick={() => setMore(false)} className={cx(item, active ? "border-t-2 border-brand-600 text-stone-900" : "border-t-2 border-transparent text-stone-500")}>
              <span className="relative">
                {n.label}
                {badge > 0 && <span className={cx("absolute -right-3 -top-1.5 font-mono text-[10px]", n.href === "/procurement" ? "text-red-700" : "text-brand-600")}>{badge}</span>}
              </span>
            </Link>
          );
        })}
        <button type="button" onClick={() => setMore((m) => !m)} className={cx(item, more || inMore ? "border-t-2 border-brand-600 text-stone-900" : "border-t-2 border-transparent text-stone-500")}>
          More
        </button>
      </nav>
    </>
  );
}
