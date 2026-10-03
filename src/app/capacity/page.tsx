import { LineSetup } from "@/components/line-setup";
import { SettingsForm } from "@/components/settings-form";
import { settingsRows } from "@/lib/queries";
import { PlanningTabs } from "@/components/planning-tabs";
import { PageHeader } from "@/components/ui";
import { loadLines } from "@/lib/capacity";
import { avgMarginPerKgByProduct } from "@/lib/order-margin";
import { loadSettings } from "@/lib/settings";
import { can } from "@/lib/domain";
import { getViewer } from "@/lib/role";

export default async function LineSetupPage() {
  const viewer = await getViewer();
  const editable = can(viewer.role, ["COO", "ADMIN"]);
  return (
    <>
      <PageHeader eyebrow="02 / Production" title="Production" emph="calendar" subtitle="How much each line can make in a normal month, and which products it can run. Change a single month from the calendar." />
      <PlanningTabs active="setup" />
      <LineSetup lines={loadLines()} editable={editable} marginPerKg={avgMarginPerKgByProduct(loadSettings())} />
      {!editable && <p className="mt-4 text-sm text-stone-500">Only the COO or admin can change line setup.</p>}
      <section className="mt-8 max-w-2xl">
        <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-700">Changeover time</div>
        <p className="mb-2 text-[13px] text-stone-600">Hours a line loses when it switches what it makes (stop, clean, restart). The calendar takes this off the line&apos;s capacity in any month it runs more than one product or blend.</p>
        <SettingsForm groups={[["Changeovers", settingsRows().filter((r) => r.grp === "Changeovers")]]} editable={editable} />
      </section>
    </>
  );
}
