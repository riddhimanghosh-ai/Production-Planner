import { DemoSteps, type DemoStep } from "@/components/demo-steps";
import { PageHeader } from "@/components/ui";
import { store } from "@/data/store";

// A click-through script for showing the prototype to SLN: one order from sale to production to purchasing.
export default function DemoPage() {
  const users = store().users;
  const id = (name: string, role?: string) => String(users.find((u) => u.name === name || u.role === role)?.id ?? "ALL");
  const steps: DemoStep[] = [
    {
      n: "01",
      who: "Rohan Mehta",
      viewer: id("Rohan Mehta"),
      where: "Orders · What we can sell",
      href: "/orders?tab=sell",
      show: "Free tonnes by product code for the next 12 months. Click a figure.",
      point: "Sales knows what it can promise before talking to the customer.",
    },
    {
      n: "02",
      who: "Rohan Mehta",
      viewer: id("Rohan Mehta"),
      where: "New order · Check availability",
      href: "/orders/new",
      show: "Pick Agglomerated and add shipments of 40 t for Feb, Mar and Apr. The lines are full; it suggests earlier months.",
      point: "Availability is checked first, live against the calendar.",
    },
    {
      n: "03",
      who: "Rohan Mehta",
      viewer: id("Rohan Mehta"),
      where: "New order · Price & payment",
      href: "/orders/new",
      show: "Break-even, CFO minimum and a suggested price. Change the target margin.",
      point: "Sales prices with the real cost, not a guess.",
    },
    {
      n: "04",
      who: "CFO",
      viewer: id("", "CFO"),
      where: "Orders · Approvals",
      href: "/orders?tab=approvals",
      show: "Seoul Beverage Corp at 16.5% margin, below the 18% minimum. Send it back with a comment.",
      point: "The CFO sees margin and payment terms in one row.",
    },
    { n: "05", who: "COO", viewer: id("", "COO"), where: "Orders · Approvals", href: "/orders?tab=approvals", show: "Ankara Gıda: line space and materials checks. Approve it.", point: "Both must approve before the factory time is locked." },
    {
      n: "06",
      who: "Production planner",
      viewer: id("", "PLANNER"),
      where: "Production calendar · New orders",
      href: "/plan?tab=new",
      show: "Overbooked months with a suggested line and month. Press Allocate.",
      point: "The tool suggests where to make each order.",
    },
    {
      n: "07",
      who: "Production planner",
      viewer: id("", "PLANNER"),
      where: "Production calendar · Daily",
      href: "/plan?tab=daily",
      show: "Line 1 is running today. Close the day with 1.4 t and a reason.",
      point: "The shop floor logs output daily; it rolls into the month.",
    },
    {
      n: "08",
      who: "Production planner",
      viewer: id("", "PLANNER"),
      where: "Production calendar · Production done",
      href: "/plan?tab=done",
      show: "Made against planned per month. Move the short tonnes to next month.",
      point: "Nothing unmade is lost.",
    },
    {
      n: "09",
      who: "Procurement",
      viewer: id("", "PROCUREMENT"),
      where: "Inventory · Needs attention",
      href: "/procurement",
      show: "What to buy, for which order, and the last day to order. Place order.",
      point: "Purchasing is driven by the approved plan and lead times.",
    },
    {
      n: "10",
      who: "CFO",
      viewer: id("", "CFO"),
      where: "Profit & costs · Price a quote",
      href: "/margins",
      show: "The cost sheet per kg. Raise the bean price and watch the margin.",
      point: "Green beans are most of the cost; the margin moves with them.",
    },
  ];
  return (
    <>
      <PageHeader eyebrow="Demo" title="A ten-minute" emph="walkthrough" subtitle="Press Go on each step: it switches who you are viewing as and opens the right screen. Reset demo data (bottom left) before you start." />
      <DemoSteps steps={steps} />
    </>
  );
}
