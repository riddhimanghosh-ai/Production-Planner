import { notFound, redirect } from "next/navigation";
import { OrderWizard } from "@/components/order-wizard";
import { PageHeader } from "@/components/ui";
import { store } from "@/data/store";
import { orderFormProps, wizardFromOrder } from "@/lib/order-form-data";
import { getViewer } from "@/lib/role";
import { canEditOrder } from "@/lib/workflow";

export default async function EditOrderPage({ params }: PageProps<"/orders/[id]/edit">) {
  const { id } = await params;
  const viewer = await getViewer();
  const order = store().orders.find((o) => o.id === Number(id));
  if (!order) notFound();
  if (!canEditOrder(viewer, order)) redirect(`/orders/${order.id}`);
  const customer = store().customers.find((c) => c.id === order.customerId);

  return (
    <>
      <PageHeader title={`Edit ${order.ref} · ${customer?.name}`} subtitle="Jump to any step to change it, then send it again. Every change is kept in the order's history." />
      <OrderWizard orderId={order.id} status={order.status} initial={wizardFromOrder(order)} {...orderFormProps(viewer)} />
    </>
  );
}
