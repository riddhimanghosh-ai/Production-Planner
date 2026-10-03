import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import { MobileNav } from "@/components/mobile-nav";
import { Nav, ResetDemoButton, ViewerSwitcher } from "@/components/shell";
import { can } from "@/lib/domain";
import { shortages } from "@/lib/inventory";
import { pendingSignoffCount, users } from "@/lib/queries";
import { getViewer } from "@/lib/role";
import "./globals.css";

// devx Doctrine type stack: display/UI sans, editorial italic serif, mono for labels.
const display = Inter_Tight({ variable: "--font-display", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-editorial", subsets: ["latin"], style: ["normal", "italic"] });
const mono = JetBrains_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SLN B2B Order & Capacity",
  description: "SLN Coffee B2B order and capacity tool (prototype)",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const viewer = await getViewer();
  const approvalCount = viewer.role === "ALL" || viewer.role === "CFO" || viewer.role === "COO" ? pendingSignoffCount(viewer) : 0;
  const alertCount = can(viewer.role, ["PROCUREMENT", "COO", "PLANNER"]) ? new Set(shortages().map((x) => x.key)).size : 0;
  const people = users().map((u) => ({ id: u.id, name: u.name, role: u.role }));
  const current = viewer.id === null ? "ALL" : String(viewer.id);
  const today = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  return (
    <html lang="en" className={`${display.variable} ${serif.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans md:flex">
        {/* Phone: a sticky top bar with the brand and the viewer switch. Desktop: a paper-2 sidebar with the navigation. */}
        <aside className="sticky top-0 z-20 border-b border-stone-300 bg-white px-4 py-3 md:static md:sticky md:top-0 md:flex md:h-screen md:w-[248px] md:shrink-0 md:flex-col md:border-b-0 md:border-r md:bg-stone-50 md:px-3 md:py-5">
          <div className="flex items-center justify-between gap-4 md:mb-5 md:block md:border-b md:border-stone-300 md:px-3 md:pb-5">
            <div>
              <div className="text-[15px] font-medium tracking-tight text-stone-900">
                SLN <em className="font-serif font-normal text-brand-600">Coffee</em>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">Order & capacity</div>
            </div>
            <div className="w-44 md:hidden">
              <ViewerSwitcher current={current} users={people} />
            </div>
          </div>
          <div className="hidden md:block">
            <Nav approvalCount={approvalCount} alertCount={alertCount} />
          </div>
          <p className="mt-auto hidden px-3 text-[11px] leading-snug text-stone-400 md:block">Prototype data, resets on restart.</p>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="hidden h-12 shrink-0 items-center justify-between border-b border-stone-300 bg-white px-8 md:flex">
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-stone-500">{today}</div>
            <div className="flex items-center gap-2">
              <ViewerSwitcher current={current} users={people} inline />
              <ResetDemoButton />
            </div>
          </div>
          <main className="min-w-0 flex-1 px-4 pb-24 pt-4 md:px-8 md:py-6">
            <div className="mx-auto w-full max-w-[1400px]">{children}</div>
          </main>
        </div>
        <MobileNav approvalCount={approvalCount} alertCount={alertCount} />
      </body>
    </html>
  );
}
