"use client";

import { useState, useTransition } from "react";
import { cancelAction, decideAction, gbClosureAction, reassignAction } from "@/app/actions";
import { buttonClass, cx } from "./ui";

export function DecisionForm({ orderId, roles, allAccess, compact }: { orderId: number; roles: string[]; allAccess: boolean; compact?: boolean }) {
  const [role, setRole] = useState(roles[0]);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const act = (decision: "APPROVED" | "REJECTED" | "SENT_BACK") =>
    start(async () => {
      const res = await decideAction(orderId, role, decision, comment);
      setError(res.error);
      if (!res.error) setComment("");
    });

  return (
    <div className={cx(!compact && "rounded-md border border-stone-300 bg-stone-50 p-2")}>
      <div className="flex flex-wrap items-center gap-1.5">
        {allAccess && roles.length > 1 ? (
          <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-sm border border-stone-300 bg-white px-1.5 py-0.5 text-xs" aria-label="Review as">
            {roles.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        ) : (
          <span className="text-xs font-semibold text-stone-700">{role}:</span>
        )}
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (needed to send back / reject)" className="min-w-40 flex-1 rounded-sm border border-stone-300 bg-white px-1.5 py-0.5 text-xs" aria-label="Comment" />
        <button type="button" disabled={pending} onClick={() => act("APPROVED")} className={buttonClass("primary", "sm")}>
          Approve
        </button>
        <button type="button" disabled={pending} onClick={() => act("SENT_BACK")} className={buttonClass("secondary", "sm")}>
          Send back
        </button>
        <button type="button" disabled={pending} onClick={() => act("REJECTED")} className={buttonClass("danger", "sm")}>
          Reject
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function CancelOrderButton({ orderId }: { orderId: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const reason = prompt("Why is this order being cancelled? Its capacity will be released.");
          if (reason === null) return;
          start(async () => setError((await cancelAction(orderId, reason)).error));
        }}
        className={buttonClass("secondary")}
      >
        Cancel order
      </button>
      {error && <span className="text-sm text-red-700">{error}</span>}
    </>
  );
}

export function ReassignForm({ orderId, owners, ownerId, priority }: { orderId: number; owners: { id: number; name: string }[]; ownerId: number; priority: "NORMAL" | "HIGH" }) {
  const [o, setO] = useState(ownerId);
  const [p, setP] = useState(priority);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const sel = "rounded-md border border-stone-300 bg-white px-2 py-1 text-sm";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select value={o} onChange={(e) => setO(Number(e.target.value))} className={sel} aria-label="BD owner">
        {owners.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <select value={p} onChange={(e) => setP(e.target.value as "NORMAL" | "HIGH")} className={sel} aria-label="Priority">
        <option value="NORMAL">Normal priority</option>
        <option value="HIGH">High priority</option>
      </select>
      <button type="button" disabled={pending || (o === ownerId && p === priority)} onClick={() => start(async () => setMsg((await reassignAction(orderId, o, p)).error ?? "Saved"))} className={buttonClass("secondary")}>
        Update
      </button>
      {msg && <span className="text-xs text-stone-500">{msg}</span>}
    </div>
  );
}

export function GbClosureForm({ orderId, closed, price, marketPrice, compact }: { orderId: number; closed: boolean; price: number | null; marketPrice: number; compact?: boolean }) {
  const [isClosed, setClosed] = useState(closed);
  const [value, setValue] = useState(String(price ?? marketPrice));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dirty = isClosed !== closed || (isClosed && Number(value) !== price);
  return (
    <div className={cx("flex flex-wrap items-center gap-2 text-xs", !compact && "text-sm")}>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" checked={isClosed} onChange={(e) => setClosed(e.target.checked)} className="h-4 w-4 accent-brand-600" />
        Bean price fixed with supplier
      </label>
      {isClosed && (
        <span className="flex items-center gap-1">
          ₹
          <input type="number" min="1" value={value} onChange={(e) => setValue(e.target.value)} className="w-20 rounded-md border border-stone-300 px-2 py-1 text-right" aria-label="Closed price per kg" />
          /kg
        </span>
      )}
      {dirty && (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setError((await gbClosureAction(orderId, isClosed, isClosed ? Number(value) : null)).error))}
          className="rounded-md bg-brand-600 px-2 py-1 font-medium text-white hover:bg-brand-700"
        >
          Save
        </button>
      )}
      {error && <span className="text-red-700">{error}</span>}
    </div>
  );
}

// One-cell decision for table rows: Approve in one click; Send back / Reject ask for a reason inline.
export function QuickDecision({ orderId, roles, allAccess }: { orderId: number; roles: string[]; allAccess: boolean }) {
  const [role, setRole] = useState(roles[0]);
  const [asking, setAsking] = useState<"REJECTED" | "SENT_BACK" | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (decision: "APPROVED" | "REJECTED" | "SENT_BACK") =>
    start(async () => {
      const res = await decideAction(orderId, role, decision, comment);
      setError(res.error);
      if (!res.error) {
        setComment("");
        setAsking(null);
      }
    });

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {allAccess && roles.length > 1 && (
        <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-sm border border-stone-300 bg-white px-1 py-0.5 text-xs" aria-label="Decide as">
          {roles.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      )}
      {!allAccess || roles.length === 1 ? <span className="text-[11px] font-semibold text-stone-500">{role}</span> : null}
      {asking ? (
        <>
          <input
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={asking === "REJECTED" ? "Why reject?" : "What to change?"}
            className="w-44 rounded-sm border border-stone-300 bg-white px-1.5 py-0.5 text-xs"
            aria-label="Reason"
          />
          <button type="button" disabled={pending || !comment.trim()} onClick={() => act(asking)} className={buttonClass(asking === "REJECTED" ? "danger" : "primary", "sm")}>
            {asking === "REJECTED" ? "Reject" : "Send back"}
          </button>
          <button type="button" onClick={() => setAsking(null)} className="px-1 text-xs text-stone-500 hover:underline">
            Cancel
          </button>
        </>
      ) : (
        <>
          <button type="button" disabled={pending} onClick={() => act("APPROVED")} className={buttonClass("primary", "sm")}>
            Approve
          </button>
          <button type="button" disabled={pending} onClick={() => setAsking("SENT_BACK")} className={buttonClass("secondary", "sm")}>
            Send back
          </button>
          <button type="button" disabled={pending} onClick={() => setAsking("REJECTED")} className="px-1 text-xs font-medium text-red-700 hover:underline">
            Reject
          </button>
        </>
      )}
      {error && <span className="w-full text-right text-xs text-red-700">{error}</span>}
    </div>
  );
}
