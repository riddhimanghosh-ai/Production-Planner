"use client";

import { useActionState, useTransition } from "react";
import { addCustomer, addUser, toggleSku } from "@/app/actions";
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
