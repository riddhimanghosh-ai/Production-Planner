import { OrderWizard } from "@/components/order-wizard";
import { Empty, PageHeader } from "@/components/ui";
import { can } from "@/lib/domain";
import { blankWizard, orderFormProps } from "@/lib/order-form-data";
import { getViewer } from "@/lib/role";

export default async function NewOrderPage({ searchParams }: PageProps<"/orders/new">) {
  const sp = await searchParams;
  const viewer = await getViewer();
  if (!can(viewer.role, ["BD_EXEC", "BD_HEAD"])) {
    return (
      <>
        <PageHeader eyebrow="01 / Orders" title="New" emph="order" />
        <Empty>Only salespeople create orders. Switch &ldquo;Viewing as&rdquo; to a salesperson, or to All access.</Empty>
      </>
    );
  }
  return (
    <>
      <PageHeader eyebrow="01 / Orders" title="New" emph="order" subtitle="Fill in the order, review it, and send it for approval. Checking room on the lines is an optional last step." />
      <OrderWizard
        initial={blankWizard(viewer, {
          product: typeof sp.product === "string" ? sp.product : undefined,
          from: typeof sp.from === "string" ? sp.from : undefined,
          blend: typeof sp.blend === "string" ? sp.blend : undefined,
          pack: typeof sp.pack === "string" ? sp.pack : undefined,
        })}
        {...orderFormProps(viewer)}
      />
    </>
  );
}
