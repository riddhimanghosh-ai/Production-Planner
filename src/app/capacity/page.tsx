import { LineSetup } from "@/components/line-setup";
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
    </>
  );
}
