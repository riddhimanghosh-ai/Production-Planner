import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
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
  const switcher = <ViewerSwitcher current={viewer.id === null ? "ALL" : String(viewer.id)} users={people} />;

  return (
    <html lang="en" className={`${display.variable} ${serif.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans md:flex">
        <aside className="border-b border-stone-300 bg-white px-4 py-4 md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-b-0 md:border-r">
          <div className="mb-3 flex items-center justify-between gap-4 md:mb-4 md:block">
            <div>
              <div className="text-[15px] font-medium tracking-tight text-stone-900">
                SLN <em className="font-serif font-normal text-brand-600">Coffee</em>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">Order & capacity</div>
            </div>
            <div className="w-48 md:hidden">{switcher}</div>
          </div>
          <Nav approvalCount={approvalCount} alertCount={alertCount} canCreate={can(viewer.role, ["BD_EXEC", "BD_HEAD"])} />
          <div className="mt-auto hidden md:block">
            {switcher}
            <p className="mt-2 text-[11px] leading-snug text-stone-500">
              Prototype data, resets on restart.
            </p>
            <ResetDemoButton />
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
      </body>
    </html>
  );
}
