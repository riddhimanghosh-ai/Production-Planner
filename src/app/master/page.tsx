import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { AddCustomerForm, AddUserForm, ToggleSkuButton } from "@/components/master-forms";
import { Badge, Card, Empty, PageHeader, Tabs } from "@/components/ui";
import { store } from "@/data/store";
import { loadLines } from "@/lib/capacity";
import { BLENDS, can, PACK_FORMATS, PRODUCT_TYPES, ROLE_LABELS, type PackFormat, type ProductType } from "@/lib/domain";
import { allSkus, bdUsers, customers, settingsRows, users } from "@/lib/queries";
import { PLANNING_GROUPS } from "@/lib/settings";
import { SettingsForm } from "@/components/settings-form";
import { getViewer } from "@/lib/role";

const TABS = [
  { key: "customers", label: "Customers" },
  { key: "users", label: "Users & roles" },
  { key: "products", label: "Products" },
  { key: "lines", label: "Lines & capacity" },
  { key: "planning", label: "Planning rules" },
];

export default async function MasterPage({ searchParams }: PageProps<"/master">) {
  const viewer = await getViewer();
  const { tab = "customers" } = await searchParams;
  if (!can(viewer.role, ["ADMIN", "COO", "CFO", "BD_HEAD"])) {
    return (
      <>
        <PageHeader eyebrow="Admin" title="Master" emph="data" />
        <Empty>Master data is managed by the admin, with the COO and CFO. Switch the &ldquo;Viewing as&rdquo; user to see it.</Empty>
      </>
    );
  }
  const isAdmin = can(viewer.role, ["ADMIN"]);
  const st = store();

  return (
    <>
      <PageHeader eyebrow="Admin" title="Master" emph="data" subtitle="Products, lines, capacity, cost norms, customers and users. Excel upload for these lists comes with the working prototype." />
      <Tabs active={String(tab)} tabs={TABS.map((t) => ({ ...t, href: `/master?tab=${t.key}` }))} />

      {tab === "customers" && (
        <Card
          title={`Customers (${customers().length})`}
          actions={
            <ExportButton
              filename="sln-customers"
              rows={[["Customer", "Country", "Contact", "BD owner", "Orders"], ...customers().map((c) => [c.name, c.country, c.contactPerson, st.users.find((u) => u.id === c.bdOwnerId)?.name, st.orders.filter((o) => o.customerId === c.id).length])]}
            />
          }
        >
          {can(viewer.role, ["ADMIN", "BD_HEAD"]) && (
            <div className="mb-4">
              <AddCustomerForm owners={bdUsers().map((u) => ({ id: u.id, name: u.name }))} />
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 text-xs text-stone-500">
                <th className="py-2 text-left font-medium">Customer</th>
                <th className="py-2 text-left font-medium">Country</th>
                <th className="py-2 text-left font-medium">Contact</th>
                <th className="py-2 text-left font-medium">BD owner</th>
                <th className="py-2 text-right font-medium">Orders</th>
              </tr>
            </thead>
            <tbody>
              {customers().map((c) => (
                <tr key={c.id} className="border-b border-stone-50 last:border-0">
                  <td className="py-2 font-medium">{c.name}</td>
                  <td className="py-2">{c.country}</td>
                  <td className="py-2">{c.contactPerson}</td>
                  <td className="py-2">{st.users.find((u) => u.id === c.bdOwnerId)?.name}</td>
                  <td className="py-2 text-right">{st.orders.filter((o) => o.customerId === c.id).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "users" && (
        <Card title="Users & roles" actions={<ExportButton filename="sln-users" rows={[["Name", "Email", "Role"], ...users().map((u) => [u.name, u.email, ROLE_LABELS[u.role]])]} />}>
          {isAdmin && (
            <div className="mb-4">
              <AddUserForm />
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 text-xs text-stone-500">
                <th className="py-2 text-left font-medium">Name</th>
                <th className="py-2 text-left font-medium">Email</th>
                <th className="py-2 text-left font-medium">Role</th>
              </tr>
            </thead>
            <tbody>
              {users().map((u) => (
                <tr key={u.id} className="border-b border-stone-50 last:border-0">
                  <td className="py-2 font-medium">{u.name}</td>
                  <td className="py-2 text-stone-600">{u.email}</td>
                  <td className="py-2">
                    <Badge tone={u.role === "CFO" || u.role === "COO" ? "brand" : "neutral"}>{ROLE_LABELS[u.role]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 rounded-sm bg-stone-50 p-3 text-xs text-stone-600">
            <b>What each role can do:</b> Salespeople create, edit and send their own orders and see only their own prices; the sales head works across all orders, reassigns and sets priority; the CFO approves on price, profit and payment; the COO
            approves on factory space and beans, and sets up the lines; the production planner moves orders on the calendar, changes monthly capacity and asks procurement for materials; procurement places purchase orders, receives stock and fixes
            bean prices; the admin manages settings. Both the CFO and COO must approve before factory time is locked.
          </div>
        </Card>
      )}

      {tab === "products" && (
        <Card
          title="Product catalogue"
          actions={
            <ExportButton
              filename="sln-products"
              rows={[["Code", "Name", "Form", "Blend", "Pack", "Pack size (kg)", "Active"], ...allSkus().map((s) => [s.code, s.name, s.productType, s.blend, s.packFormat, s.packSizeKg, s.active ? "yes" : "no"])]}
            />
          }
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 text-xs text-stone-500">
                <th className="py-2 text-left font-medium">Code</th>
                <th className="py-2 text-left font-medium">Product form</th>
                <th className="py-2 text-left font-medium">Blend</th>
                <th className="py-2 text-left font-medium">Pack</th>
                <th className="py-2 text-left font-medium">Status</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {allSkus().map((s) => (
                <tr key={s.id} className="border-b border-stone-50 last:border-0">
                  <td className="py-2 font-medium">{s.code}</td>
                  <td className="py-2">{PRODUCT_TYPES[s.productType as ProductType]}</td>
                  <td className="py-2">{BLENDS[s.blend as keyof typeof BLENDS]}</td>
                  <td className="py-2">
                    {PACK_FORMATS[s.packFormat as PackFormat]} · {s.packSizeKg >= 1 ? `${s.packSizeKg} kg` : `${s.packSizeKg * 1000} g`}
                  </td>
                  <td className="py-2">{s.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                  {isAdmin && (
                    <td className="py-2 text-right">
                      <ToggleSkuButton skuId={s.id} active={s.active} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-stone-500">The MoM counts 9 product categories; confirm the exact list with SLN. Cost norms per form and pack are on the Margins → Cost norms tab.</p>
        </Card>
      )}

      {tab === "planning" && (
        <>
          <p className="mb-3 text-[13px] text-stone-600">Filling capacity for jars and cans, and how long each material takes to arrive. The calendar and the inventory screen use these to warn about gaps.</p>
          <SettingsForm groups={PLANNING_GROUPS.map((g) => [g, settingsRows().filter((r) => r.grp === g)] as [string, ReturnType<typeof settingsRows>])} editable={can(viewer.role, ["CFO", "COO", "ADMIN"])} />
        </>
      )}

      {tab === "lines" && (
        <Card title="Lines & capacity">
          <table className="w-full text-sm">
            <tbody>
              {loadLines().map((l) => (
                <tr key={l.id} className="border-b border-stone-50 last:border-0">
                  <td className="py-2 font-medium">{l.code}</td>
                  <td className="py-2 text-stone-600">{l.name}</td>
                  <td className="py-2">
                    {l.capacityMt} tonnes/month · makes {l.productTypes.map((p) => PRODUCT_TYPES[p as ProductType].toLowerCase()).join(" or ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-sm">
            Edit line capabilities and monthly capacity in{" "}
            <Link href="/capacity" className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
              Production calendar → Line setup
            </Link>
            ; cost norms in{" "}
            <Link href="/margins?tab=norms" className="font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
              Margins → Cost norms
            </Link>
            .
          </p>
        </Card>
      )}
    </>
  );
}
