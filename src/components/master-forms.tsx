"use client";

import { useActionState, useTransition } from "react";
import { addCustomer, addUser, setSkuPriority, toggleSku } from "@/app/actions";
import { ROLE_LABELS, ROLES } from "@/lib/domain";
import { buttonClass } from "./ui";

const input = "rounded-sm border border-stone-300 bg-white px-2.5 py-1.5 text-sm";

export function AddCustomerForm({ owners }: { owners: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(addCustomer, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="name" placeholder="Customer name" className={input} />
      <input name="country" placeholder="Country" defaultValue="India" className={input} />
      <input name="contactPerson" placeholder="Contact person" className={input} />
      <select name="bdOwnerId" className={input} defaultValue="">
        <option value="" disabled>
          BD owner…
        </option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <button disabled={pending} className={buttonClass("primary")}>
        Add customer
      </button>
      {state.message && <span className="text-sm text-stone-600">{state.message}</span>}
    </form>
  );
}

export function AddUserForm() {
  const [state, action, pending] = useActionState(addUser, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="name" placeholder="Full name" className={input} />
      <input name="email" type="email" placeholder="Email" className={input} />
      <select name="role" className={input} defaultValue="BD_EXEC">
        {ROLES.filter((r) => r !== "ALL").map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <button disabled={pending} className={buttonClass("primary")}>
        Add user
      </button>
      {state.message && <span className="text-sm text-stone-600">{state.message}</span>}
    </form>
  );
}

export function ToggleSkuButton({ skuId, active }: { skuId: number; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(() => toggleSku(skuId))} className="text-xs font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600 disabled:opacity-50">
      {active ? "Deactivate" : "Activate"}
    </button>
  );
}

// Sales priority per product: High (push it), Normal, Low (avoid), plus the reason the salesperson sees.
export function SkuPriorityForm({ skuId, priority, note, editable }: { skuId: number; priority: string; note: string; editable: boolean }) {
  const [state, action, pending] = useActionState(setSkuPriority, {});
  if (!editable)
    return (
      <span className="text-[13px]">
        <b className={priority === "HIGH" ? "text-emerald-700" : priority === "LOW" ? "text-red-700" : "text-stone-500"}>{priority === "HIGH" ? "Push" : priority === "LOW" ? "Avoid" : "Normal"}</b>
        {note && <span className="ml-1.5 text-stone-500">{note}</span>}
      </span>
    );
  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="skuId" value={skuId} />
      <select name="priority" defaultValue={priority} className="w-24" aria-label="Sales priority">
        <option value="HIGH">Push</option>
        <option value="NORMAL">Normal</option>
        <option value="LOW">Avoid</option>
      </select>
      <input name="note" defaultValue={note} placeholder="Why, in a line" className="w-72" aria-label="Reason" />
      <button type="submit" disabled={pending} className={buttonClass("secondary", "sm")}>
        {pending ? "…" : state.message === "Saved" ? "Saved" : "Save"}
      </button>
    </form>
  );
}
