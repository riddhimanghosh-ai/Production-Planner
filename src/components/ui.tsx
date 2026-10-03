import Link from "next/link";
import type { ReactNode } from "react";
import { ORDER_STATUS, type OrderStatus } from "@/lib/domain";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// Doctrine headline: mono eyebrow, display sans title with one italic serif accent word.
export function PageHeader({ title, emph, eyebrow, subtitle, actions }: { title: string; emph?: string; eyebrow?: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-stone-300 pb-3 md:mb-6 md:pb-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">{eyebrow}</div>}
        <h1 className="text-[22px] font-medium leading-tight tracking-[-0.02em] text-stone-900 md:text-[26px]">
          {title}
          {emph && (
            <>
              {" "}
              <em className="font-serif font-normal text-brand-600">{emph}</em>
            </>
          )}
        </h1>
        {subtitle && <p className="mt-1 text-[13px] text-stone-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// Flat panel with a grey title bar — the basic container of the tool.
export function Card({ title, actions, children, className, flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cx("border border-stone-300 bg-white", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-stone-300 px-3 py-2">
          <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-700">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={flush ? "" : "p-3"}>{children}</div>
    </section>
  );
}

// Dense data table styles shared across screens.
export const tbl = {
  wrap: "overflow-x-auto border border-stone-300 bg-white",
  table: "tabular w-full border-collapse text-[13px]",
  th: "sticky top-0 z-10 whitespace-nowrap border-b border-stone-300 bg-stone-50 px-2.5 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-700",
  thR: "sticky top-0 z-10 whitespace-nowrap border-b border-stone-300 bg-stone-50 px-2.5 py-2 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-700",
  tr: "border-b border-stone-200 last:border-0 hover:bg-stone-50",
  td: "px-2.5 py-1.5 align-middle",
  tdR: "whitespace-nowrap px-2.5 py-1.5 text-right align-middle",
  input: "border border-stone-300 bg-white px-1.5 py-0.5 text-[13px] outline-none focus:border-brand-600",
};

const tones = {
  neutral: "bg-stone-100 text-stone-700 border-stone-300",
  brand: "bg-brand-50 text-brand-700 border-brand-200",
  green: "bg-emerald-50 text-emerald-800 border-emerald-300",
  amber: "bg-amber-50 text-amber-900 border-amber-300",
  red: "bg-red-50 text-red-800 border-red-300",
  blue: "bg-sky-50 text-sky-800 border-sky-300",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap border px-1.5 py-px text-[11px] font-medium", tones[tone])}>{children}</span>;
}

const statusTone: Record<OrderStatus, Tone> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "amber",
  SENT_BACK: "blue",
  COMMITTED: "green",
  REJECTED: "red",
  CANCELLED: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone[status as OrderStatus] ?? "neutral"}>{ORDER_STATUS[status as OrderStatus] ?? status}</Badge>;
}

// A single stat cell; used inside StatStrip.
export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "red" | "amber" | "green" }) {
  return (
    <div className="min-w-0 flex-1 border-r border-stone-300 px-4 py-3 last:border-r-0">
      <div className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">{label}</div>
      <div className={cx("tabular mt-1 text-[30px] font-normal leading-none tracking-[-0.035em]", tone === "red" ? "text-red-700" : tone === "green" ? "text-emerald-700" : "text-stone-900")}>{value}</div>
      {hint && <div className="mt-1 truncate text-[12px] text-stone-500">{hint}</div>}
    </div>
  );
}

export function StatStrip({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex flex-wrap overflow-hidden border-t border-stone-900 border-b border-b-stone-300 bg-white", className)}>{children}</div>;
}

export function ButtonLink({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <Link href={href} className={buttonClass(variant)}>
      {children}
    </Link>
  );
}

export function buttonClass(variant: "primary" | "secondary" | "danger" = "primary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-1.5 border font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40",
    size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1.5 text-[13px]",
    variant === "primary" && "border-stone-900 bg-stone-900 text-white hover:border-brand-600 hover:bg-brand-600",
    variant === "secondary" && "border-stone-300 bg-white text-stone-900 hover:border-stone-900",
    variant === "danger" && "border-red-600 bg-white text-red-700 hover:bg-red-600 hover:text-white",
  );
}

export function Tabs({ tabs, active }: { tabs: { href: string; label: string; key: string; count?: number }[]; active: string }) {
  return (
    <div className="-mx-4 mb-4 flex gap-5 overflow-x-auto border-b border-stone-300 px-4 md:mx-0 md:px-0">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cx(
            "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 py-2 text-[14px] font-semibold transition-colors",
            t.key === active ? "border-brand-600 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-900",
          )}
        >
          {t.label}
          {!!t.count && <span className="font-mono text-[11px] text-stone-500">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function IssueList({ issues }: { issues: { severity: string; message: string }[] }) {
  if (!issues.length) return <p className="text-[13px] text-emerald-700">No conflicts.</p>;
  return (
    <ul className="divide-y divide-stone-200 rounded-md border border-stone-300 text-[13px]">
      {issues.map((i, n) => (
        <li key={n} className={cx("px-2.5 py-1", i.severity === "error" && "bg-red-50 text-red-800", i.severity === "warning" && "bg-amber-50 text-amber-900", i.severity === "info" && "bg-sky-50 text-sky-900")}>
          {i.severity === "error" ? "✕ " : ""}
          {i.message}
        </li>
      ))}
    </ul>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="border border-stone-300 bg-stone-50 p-4 text-[13px] text-stone-500">{children}</div>;
}

export function utilTone(load: number, capacity: number) {
  const pct = capacity > 0 ? load / capacity : 0;
  if (pct > 1.001) return "bg-red-100 text-red-800 ring-red-300";
  if (pct >= 0.9) return "bg-amber-100 text-amber-900 ring-amber-300";
  if (pct >= 0.5) return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  return "bg-white text-stone-600 ring-stone-200";
}

// Page switcher for long server-rendered tables: « 1 2 3 » built from plain links.
export function Pager({ page, pages, total, href }: { page: number; pages: number; total: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  const btn = "min-w-7 border border-stone-300 px-2 py-0.5 text-center font-mono text-[11px]";
  return (
    <div className="flex items-center justify-between gap-2 border-t border-stone-300 px-3 py-1.5 text-[12px] text-stone-500">
      <span>{total} rows</span>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={href(page - 1)} className={cx(btn, "bg-white hover:bg-stone-50")}>
            ‹
          </Link>
        ) : (
          <span className={cx(btn, "opacity-40")}>‹</span>
        )}
        {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
          <Link key={p} href={href(p)} className={cx(btn, p === page ? "border-stone-900 bg-stone-900 text-white" : "bg-white hover:border-stone-900")}>
            {p}
          </Link>
        ))}
        {page < pages ? (
          <Link href={href(page + 1)} className={cx(btn, "bg-white hover:bg-stone-50")}>
            ›
          </Link>
        ) : (
          <span className={cx(btn, "opacity-40")}>›</span>
        )}
      </div>
    </div>
  );
}
