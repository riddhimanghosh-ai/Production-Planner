"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { availabilityAction, previewOrder, saveOrderAction } from "@/app/actions";
import type { Sku } from "@/data/types";
import {
  addMonths,
  BLENDS,
  coffeeShare,
  CURRENCIES,
  formatInr,
  FREIGHT_BASIS,
  GB_GRADES,
  INCOTERMS,
  monthLabel,
  monthRange,
  ORIGINS,
  PACK_FORMATS,
  PAYMENT_MODES,
  PRODUCT_TYPES,
  productLabel,
  type Origin,
  type PackFormat,
  type ProductType,
} from "@/lib/domain";
import { computeMargin } from "@/lib/margin";
import type { OrderInput } from "@/lib/workflow";
import { buttonClass, cx } from "./ui";

type Preview = Awaited<ReturnType<typeof previewOrder>>;
type Availability = Awaited<ReturnType<typeof availabilityAction>>;
type LineOpt = { id: number; code: string; name: string; productTypes: string[] };
type CustomerOpt = { id: number; name: string; country: string; contactPerson: string; bdOwnerId: number; orderCount: number };

export type WizardState = Omit<OrderInput, "lines"> & {
  productType: string;
  blend: string;
  packFormat: string;
  chicoryPct: number;
  qtyPerMonth: number;
  fromMonth: string;
  toMonth: string;
  pricePerKg: number;
  manual: Record<string, Record<number, number>> | null;
};

const STEPS = [
  { key: "what", title: "Check availability", hint: "" },
  { key: "customer", title: "Customer", hint: "Who is buying" },
  { key: "delivery", title: "Delivery", hint: "Where it goes" },
  { key: "beans", title: "Raw coffee", hint: "Which green beans" },
  { key: "price", title: "Price & payment", hint: "Price, terms and profit" },
  { key: "review", title: "Review & submit", hint: "Check and send for approval" },
] as const;

const field = "mt-0.5 block w-full rounded-sm border border-stone-300 bg-white px-2 py-1 text-[13px] outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-200 disabled:bg-stone-50";
const tonnes = (kgOrT: number, unit = "t") => `${kgOrT.toLocaleString("en-IN", { maximumFractionDigits: 1 })} ${unit}`;

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1 flex items-baseline gap-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-700">{children}</div>
      {hint && <div className="text-[11px] text-stone-500">{hint}</div>}
    </div>
  );
}

// Searchable dropdown: type to filter, pick a customer, or add a new one with the typed name.
function CustomerSearch({ customers, selectedId, newName, onPick, onNew }: { customers: CustomerOpt[]; selectedId: number | null; newName: string; onPick: (id: number) => void; onNew: (name: string) => void }) {
  const selected = customers.find((c) => c.id === selectedId);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const matches = customers.filter((c) => `${c.name} ${c.contactPerson} ${c.country}`.toLowerCase().includes(q.toLowerCase()));
  const options = [...matches.map((c) => ({ kind: "c" as const, c })), ...(q.trim() && !customers.some((c) => c.name.toLowerCase() === q.trim().toLowerCase()) ? [{ kind: "new" as const, c: null }] : [])];
  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.kind === "c") onPick(o.c.id);
    else onNew(q.trim());
    setQ("");
    setOpen(false);
  };
  const shown = selected ? selected.name : newName ? `${newName} (new)` : "";

  return (
    <div className="relative">
      <input
        value={open ? q : shown}
        placeholder="Search customer…"
        onFocus={() => {
          setOpen(true);
          setQ("");
          setHi(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQ(e.target.value);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setHi((h) => Math.min(options.length - 1, h + 1));
          else if (e.key === "ArrowUp") setHi((h) => Math.max(0, h - 1));
          else if (e.key === "Enter") {
            e.preventDefault();
            choose(hi);
          } else if (e.key === "Escape") setOpen(false);
          else return;
          e.preventDefault();
        }}
        className={cx(field, "pr-7")}
        role="combobox"
        aria-controls="customer-options"
        aria-expanded={open}
        aria-label="Customer"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-stone-400">▼</span>
      {open && (
        <ul className="absolute z-20 mt-0.5 max-h-64 w-full overflow-y-auto rounded-sm border border-stone-300 bg-white text-[13px] shadow-lg" role="listbox" id="customer-options">
          {options.map((o, i) => (
            <li
              key={o.kind === "c" ? o.c.id : "new"}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
              onMouseEnter={() => setHi(i)}
              className={cx("flex cursor-pointer items-center justify-between gap-2 border-b border-stone-100 px-2 py-1 last:border-0", i === hi && "bg-brand-50")}
            >
              {o.kind === "c" ? (
                <>
                  <span className="font-medium text-stone-900">{o.c.name}</span>
                  <span className="text-[11px] text-stone-500">{o.c.contactPerson}</span>
                </>
              ) : (
                <span className="font-medium text-brand-700">+ Add “{q.trim()}” as new customer</span>
              )}
            </li>
          ))}
          {options.length === 0 && <li className="px-2 py-1.5 text-stone-500">Type a name to add a new customer</li>}
        </ul>
      )}
    </div>
  );
}

function fmtPrice(p: number | null, currency: string) {
  if (p == null) return "–";
  return currency === "USD" ? `$${p.toFixed(2)}` : `₹${p.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function Pick({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-600">{label}</span>
      {children}
    </label>
  );
}

function Err({ msg }: { msg?: string }) {
  return msg ? <div className="mt-1 text-xs font-medium text-red-600">{msg}</div> : null;
}

export function OrderWizard({
  orderId,
  status,
  initial,
  skus,
  lines,
  customers,
  owners,
  months,
  viewer,
  marketPrices,
  leadDays,
  settings,
}: {
  orderId?: number;
  status?: string;
  initial: WizardState;
  skus: Sku[];
  lines: LineOpt[];
  customers: CustomerOpt[];
  owners: { id: number; name: string }[];
  months: string[];
  viewer: { id: number | null; role: string };
  marketPrices: Record<string, number>;
  leadDays: Record<string, number>;
  settings: Record<string, number>;
}) {
  const [v, setV] = useState<WizardState>(initial);
  const [step, setStep] = useState(orderId ? 5 : 0);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [, startCheck] = useTransition();
  const set = <K extends keyof WizardState>(k: K, value: WizardState[K]) => setV((x) => ({ ...x, [k]: value }));
  const live = status === "PENDING_APPROVAL" || status === "COMMITTED";

  const sku = skus.find((s) => s.productType === v.productType && s.blend === v.blend && s.packFormat === v.packFormat);
  const orderMonths = v.fromMonth && v.toMonth && v.toMonth >= v.fromMonth ? monthRange(v.fromMonth, v.toMonth) : [];
  const totalT = v.qtyPerMonth * orderMonths.length;
  const makeable = (pt: string) => lines.some((l) => l.productTypes.includes(pt));

  // Availability check as soon as product, tonnes and months are known.
  useEffect(() => {
    if (!v.productType || !(v.qtyPerMonth > 0) || !orderMonths.length) return;
    const t = setTimeout(() => startCheck(async () => setAvail(await availabilityAction(v.productType, orderMonths, v.qtyPerMonth, orderId))), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.productType, v.qtyPerMonth, v.fromMonth, v.toMonth, orderId]);

  // Order lines = each month split across lines (the planner's proposal, or the salesperson's own split).
  const orderLines = useMemo(() => {
    if (!sku || !avail) return [];
    return avail.perMonth.flatMap((m) => {
      const manual = v.manual?.[m.month];
      if (manual) {
        return Object.entries(manual)
          .filter(([, q]) => q > 0)
          .map(([lineId, q]) => ({ skuId: sku.id, chicoryPct: v.chicoryPct, month: m.month, quantityMt: q, pricePerKg: v.pricePerKg, lineId: Number(lineId) }));
      }
      const split = m.proposal.map((p) => ({ ...p }));
      if (m.short > 0) {
        if (split.length) split[0].quantityMt = Math.round((split[0].quantityMt + m.short) * 10) / 10;
        else if (m.lines[0]) split.push({ lineId: m.lines[0].lineId, quantityMt: m.short });
      }
      return split.map((p) => ({ skuId: sku.id, chicoryPct: v.chicoryPct, month: m.month, quantityMt: p.quantityMt, pricePerKg: v.pricePerKg, lineId: p.lineId }));
    });
  }, [avail, sku, v.manual, v.chicoryPct, v.pricePerKg]);

  const input: OrderInput = useMemo(
    () => ({
      customerId: v.customerId,
      newCustomerName: v.newCustomerName,
      customerCountry: v.customerCountry,
      contactPerson: v.contactPerson,
      customerType: v.customerType,
      bdOwnerId: v.bdOwnerId,
      destinationCountry: v.destinationCountry,
      destinationPort: v.destinationPort,
      incoterm: v.incoterm,
      freightBasis: v.freightBasis,
      gbGrade: v.gbGrade,
      beanOrigin: v.beanOrigin,
      gbPriceClosed: v.gbPriceClosed,
      gbClosedPrice: v.gbClosedPrice,
      advancePct: v.advancePct,
      creditDays: v.creditDays,
      paymentMode: v.paymentMode,
      currency: v.currency,
      specNotes: v.specNotes,
      spillOverride: v.spillOverride,
      lines: orderLines,
    }),
    [v, orderLines],
  );

  useEffect(() => {
    const t = setTimeout(() => startCheck(async () => setPreview(await previewOrder(input, orderId))), 300);
    return () => clearTimeout(t);
  }, [input, orderId]);

  const errors = { ...(preview?.errors ?? {}), ...serverErrors };
  const shortMonths =
    avail?.perMonth.filter((m) => {
      const manual = v.manual?.[m.month];
      if (!manual) return m.short > 0;
      return Object.entries(manual).some(([lineId, q]) => q > (m.lines.find((l) => l.lineId === Number(lineId))?.free ?? 0) + 0.05);
    }) ?? [];
  const materialShort = preview?.materials.filter((m) => m.short > 0.5) ?? [];

  const stepDone = [
    !!sku && v.qtyPerMonth > 0 && orderMonths.length > 0,
    !!(v.customerId || v.newCustomerName.trim()) && !!v.contactPerson.trim() && !!v.bdOwnerId,
    !!v.destinationPort.trim() && !!v.destinationCountry.trim() && !!v.incoterm,
    !!v.beanOrigin && !!v.gbGrade && (!v.gbPriceClosed || (v.gbClosedPrice ?? 0) > 0),
    v.pricePerKg > 0 && !!v.paymentMode,
    false,
  ];
  const canGoNext = step < 5 && stepDone[step];

  const save = (intent: "draft" | "submit") =>
    startSave(async () => {
      const res = await saveOrderAction(input, intent, orderId);
      if (res) {
        setServerErrors(res.errors ?? {});
        setMessage(res.message ?? null);
      }
    });

  const chooseCustomer = (id: number | "new") => {
    if (id === "new") return setV((x) => ({ ...x, customerId: null, customerType: "NEW" }));
    const c = customers.find((x) => x.id === id)!;
    setV((x) => ({
      ...x,
      customerId: c.id,
      newCustomerName: "",
      contactPerson: c.contactPerson,
      customerType: c.orderCount > 0 ? "REPEAT" : "NEW",
      bdOwnerId: viewer.role === "BD_EXEC" ? x.bdOwnerId : c.bdOwnerId,
      destinationCountry: x.destinationCountry || c.country,
    }));
  };

  const useSuggestion = () => {
    if (!avail?.suggestion) return;
    const len = orderMonths.length;
    setV((x) => ({ ...x, fromMonth: avail.suggestion!, toMonth: addMonths(avail.suggestion!, len - 1), manual: null }));
  };

  const customer = customers.find((c) => c.id === v.customerId);
  const profitOk = preview && preview.margin.revenue > 0 && preview.margin.marginPct >= preview.margin.targetPct;

  // Suggested price: cost is fixed per kg except the credit cost, which scales with price.
  const minPct = settings["margin.target_pct"];
  const [wantPct, setWantPct] = useState(minPct + 4);
  const pricing = useMemo(() => {
    if (!v.productType) return null;
    const probe = computeMargin(
      {
        sku: { productType: v.productType, blend: v.blend, packFormat: v.packFormat, coffeeShare: coffeeShare(v.blend, v.chicoryPct) },
        quantityMt: 1,
        pricePerKg: 1000,
        currency: "INR",
        beanOrigin: v.beanOrigin || "VIETNAM",
        gbClosedPrice: v.gbPriceClosed ? v.gbClosedPrice : null,
        freightBasis: v.freightBasis,
        advancePct: v.advancePct,
        creditDays: v.creditDays,
      },
      settings,
    );
    const creditShare = (settings["finance.cost_pct_30d"] / 100) * (v.creditDays / 30) * (1 - Math.min(Math.max(v.advancePct, 0), 100) / 100);
    const fixed = probe.costPerKg - 1000 * creditShare;
    const fx = v.currency === "USD" ? settings["fx.usd_inr"] : 1;
    const priceFor = (pct: number) => {
      const d = 1 - creditShare - pct / 100;
      return d > 0 ? Math.ceil((fixed / d / fx) * (fx === 1 ? 1 : 100)) / (fx === 1 ? 1 : 100) : null;
    };
    const marginAt = (price: number) => {
      const inr = price * fx;
      return inr > 0 ? ((inr - fixed - inr * creditShare) / inr) * 100 : null;
    };
    return { costNoCredit: fixed / fx, priceFor, marginAt };
  }, [v.productType, v.blend, v.packFormat, v.chicoryPct, v.beanOrigin, v.gbPriceClosed, v.gbClosedPrice, v.freightBasis, v.advancePct, v.creditDays, v.currency, settings]);

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0">
        {/* Stepper */}
        <ol className="mb-3 flex flex-wrap border-b border-stone-300">
          {STEPS.map((st, i) => (
            <li key={st.key}>
              <button
                type="button"
                onClick={() => setStep(i)}
                className={cx("-mb-px mr-5 flex items-center gap-1.5 whitespace-nowrap border-b-2 py-2 text-[14px] font-semibold transition-colors", i === step ? "border-brand-600 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-900")}
              >
                <span className={cx("flex h-4 w-4 items-center justify-center rounded-sm text-[10px] font-bold", stepDone[i] ? "bg-emerald-600 text-white" : i === step ? "bg-brand-600 text-white" : "bg-stone-200 text-stone-600")}>
                  {stepDone[i] ? "✓" : i + 1}
                </span>
                {st.title}
              </button>
            </li>
          ))}
        </ol>

        {message && <div className="mb-2 border border-red-300 bg-red-50 px-3 py-1.5 text-[13px] text-red-800">{message}, see the steps marked below.</div>}
        {live && step !== 5 && (
          <div className="mb-2 border border-amber-300 bg-amber-50 px-3 py-1.5 text-[13px] text-amber-900">
            This order is {status === "COMMITTED" ? "approved" : "waiting for approval"}. Changing tonnes, months, lines, price or the bean price sends it back to the CFO and COO.
          </div>
        )}

        <section className="rounded-md border border-stone-300 bg-white p-4">
          <div className="mb-3 flex items-baseline gap-2 border-b border-stone-200 pb-2">
            <h2 className="text-sm font-semibold text-stone-900">
              Step {step + 1} of 6 · {STEPS[step].title}
            </h2>
          </div>

          {step === 0 && (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Pick label="Product">
                  <select value={v.productType} onChange={(e) => setV((x) => ({ ...x, productType: e.target.value, manual: null }))} className={field}>
                    <option value="">Choose…</option>
                    {(Object.keys(PRODUCT_TYPES) as ProductType[]).map((pt) => (
                      <option key={pt} value={pt}>
                        {PRODUCT_TYPES[pt]}
                        {makeable(pt) ? "" : " (no line yet)"}
                      </option>
                    ))}
                  </select>
                </Pick>
                <Pick label="Recipe">
                  <select value={v.blend} onChange={(e) => set("blend", e.target.value)} className={field}>
                    {(Object.keys(BLENDS) as (keyof typeof BLENDS)[]).map((b) => (
                      <option key={b} value={b}>
                        {BLENDS[b]}
                      </option>
                    ))}
                  </select>
                  {v.blend === "CHICORY" && (
                    <select value={v.chicoryPct} onChange={(e) => set("chicoryPct", Number(e.target.value))} className={field} aria-label="Chicory share">
                      {[10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map((p) => (
                        <option key={p} value={p}>
                          {p}% chicory
                        </option>
                      ))}
                    </select>
                  )}
                </Pick>
                <Pick label="Packing">
                  <select value={v.packFormat} onChange={(e) => set("packFormat", e.target.value)} className={field}>
                    {(Object.keys(PACK_FORMATS) as PackFormat[]).map((p) => (
                      <option key={p} value={p}>
                        {PACK_FORMATS[p]}
                      </option>
                    ))}
                  </select>
                </Pick>
                <Pick label="Tonnes / month">
                  <input type="number" min="0" step="1" value={v.qtyPerMonth || ""} onChange={(e) => setV((x) => ({ ...x, qtyPerMonth: Number(e.target.value), manual: null }))} className={cx(field, "font-semibold")} placeholder="20" />
                </Pick>
                <Pick label="From">
                  <select value={v.fromMonth} onChange={(e) => setV((x) => ({ ...x, fromMonth: e.target.value, toMonth: x.toMonth < e.target.value ? e.target.value : x.toMonth, manual: null }))} className={field}>
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {monthLabel(m)}
                      </option>
                    ))}
                  </select>
                </Pick>
                <Pick label="To">
                  <select value={v.toMonth} onChange={(e) => setV((x) => ({ ...x, toMonth: e.target.value, manual: null }))} className={field}>
                    {months
                      .filter((m) => m >= v.fromMonth)
                      .map((m) => (
                        <option key={m} value={m}>
                          {monthLabel(m)}
                        </option>
                      ))}
                  </select>
                </Pick>
              </div>
              {v.productType && makeable(v.productType) && !sku && <p className="border border-amber-300 bg-amber-50 px-3 py-1.5 text-[13px] text-amber-900">Not in the product list, pick another recipe or packing.</p>}

              {v.productType && !makeable(v.productType) ? (
                <div className="border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-900">
                  ✕ No production line makes {PRODUCT_TYPES[v.productType as ProductType]} yet, so it can&apos;t be booked.{" "}
                  <Link href="/capacity" className="font-semibold underline">
                    Set up a line
                  </Link>
                </div>
              ) : (
                <AvailabilityPanel
                  avail={avail}
                  ready={!!v.productType && v.qtyPerMonth > 0 && orderMonths.length > 0}
                  totalT={totalT}
                  manual={v.manual}
                  onManual={(m) => set("manual", m)}
                  onUseSuggestion={useSuggestion}
                  suggestionLabel={avail?.suggestion ? `${monthLabel(avail.suggestion)} – ${monthLabel(addMonths(avail.suggestion, orderMonths.length - 1))} (${shiftText(v.fromMonth, avail.suggestion)})` : null}
                />
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div className="sm:w-96">
                <Label>Customer</Label>
                <CustomerSearch
                  customers={customers}
                  selectedId={v.customerId}
                  newName={v.newCustomerName}
                  onPick={(id) => chooseCustomer(id)}
                  onNew={(name) => setV((x) => ({ ...x, customerId: null, customerType: "NEW", newCustomerName: name, contactPerson: "" }))}
                />
                <Err msg={errors.customer} />
              </div>
              {!v.customerId && v.newCustomerName && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Company name</span>
                    <input value={v.newCustomerName} onChange={(e) => set("newCustomerName", e.target.value)} className={field} />
                  </label>
                  <label className="text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Country</span>
                    <input value={v.customerCountry} onChange={(e) => set("customerCountry", e.target.value)} className={field} />
                  </label>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Contact person</span>
                  <input value={v.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} className={field} />
                  <Err msg={errors.contactPerson} />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">New or repeat?</span>
                  <select value={v.customerType} onChange={(e) => set("customerType", e.target.value as "NEW" | "REPEAT")} className={field}>
                    <option value="NEW">New customer</option>
                    <option value="REPEAT">Repeat customer</option>
                  </select>
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Salesperson</span>
                  <select value={v.bdOwnerId || ""} onChange={(e) => set("bdOwnerId", Number(e.target.value))} disabled={viewer.role === "BD_EXEC"} className={field}>
                    <option value="">Choose…</option>
                    {owners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Deliver to (city or port)</span>
                  <input value={v.destinationPort} onChange={(e) => set("destinationPort", e.target.value)} className={field} placeholder="e.g. Chennai" />
                  <Err msg={errors.destinationPort} />
                </label>
                <label className="text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Country</span>
                  <input value={v.destinationCountry} onChange={(e) => set("destinationCountry", e.target.value)} className={field} />
                </label>
              </div>
              <label className="block text-sm sm:w-72">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Who pays freight?</span>
                <select value={v.freightBasis} onChange={(e) => set("freightBasis", e.target.value)} className={field}>
                  {Object.entries(FREIGHT_BASIS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm sm:w-72">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Shipping term (Incoterm)</span>
                <select value={v.incoterm} onChange={(e) => set("incoterm", e.target.value)} className={field}>
                  {INCOTERMS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <label className="block text-sm sm:w-80">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Bean origin</span>
                <select
                  value={v.beanOrigin}
                  onChange={(e) => {
                    const o = e.target.value as Origin;
                    setV((x) => ({ ...x, beanOrigin: o, gbClosedPrice: x.gbPriceClosed ? x.gbClosedPrice : marketPrices[o] }));
                  }}
                  className={field}
                >
                  {(Object.keys(ORIGINS) as Origin[]).map((o) => (
                    <option key={o} value={o}>
                      {ORIGINS[o]} · ₹{marketPrices[o]}/kg · {leadDays[o]} days
                    </option>
                  ))}
                </select>
                <Err msg={errors.beanOrigin} />
              </label>
              <label className="block text-sm sm:w-80">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Bean grade</span>
                <select value={v.gbGrade} onChange={(e) => set("gbGrade", e.target.value)} className={field}>
                  <option value="">Choose…</option>
                  {GB_GRADES.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
                <Err msg={errors.gbGrade} />
              </label>
              <div className="border border-stone-300 bg-stone-50 p-2">
                <label className="flex items-center gap-3 text-sm font-semibold text-stone-900">
                  <input
                    type="checkbox"
                    checked={v.gbPriceClosed}
                    onChange={(e) => setV((x) => ({ ...x, gbPriceClosed: e.target.checked, gbClosedPrice: x.gbClosedPrice ?? marketPrices[x.beanOrigin] ?? null }))}
                    className="h-5 w-5 accent-brand-600"
                  />
                  The bean price is already fixed with the supplier
                </label>
                {v.gbPriceClosed ? (
                  <div className="mt-3 flex items-center gap-2 text-sm">
                    Fixed at ₹
                    <input type="number" min="1" value={v.gbClosedPrice ?? ""} onChange={(e) => set("gbClosedPrice", e.target.value ? Number(e.target.value) : null)} className="w-28 rounded-sm border border-stone-300 px-3 py-2 text-right" />
                    per kg
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-stone-500">Not fixed, using market price.</p>
                )}
              </div>
              {preview && preview.margin.greenBeanKg > 0 && (
                <p className="text-sm text-stone-600">
                  This order needs about <b>{tonnes(preview.margin.greenBeanKg / 1000)}</b> of green beans.
                </p>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-5">
                {pricing && (
                  <table className="w-full border border-stone-300 text-[13px]">
                    <thead>
                      <tr className="bg-stone-100 text-[11px] uppercase tracking-wide text-stone-600">
                        <th className="px-2.5 py-1 text-left">Margin</th>
                        <th className="px-2.5 py-1 text-right">Price / kg</th>
                        <th className="px-2.5 py-1" />
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "Break-even", pct: 0 },
                        { label: `CFO minimum`, pct: minPct },
                      ].map((r) => (
                        <tr key={r.label}>
                          <td className="px-2.5 py-1 text-stone-600">
                            {r.label} <span className="text-stone-400">({r.pct}%)</span>
                          </td>
                          <td className="px-2.5 py-1 text-right">{fmtPrice(pricing.priceFor(r.pct), v.currency)}</td>
                          <td className="px-2.5 py-1 text-right">
                            <button type="button" onClick={() => set("pricePerKg", pricing.priceFor(r.pct) ?? 0)} className="text-xs font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
                              Use
                            </button>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-brand-50 font-semibold">
                        <td className="px-2.5 py-1">
                          Suggested at{" "}
                          <input type="number" min="0" max="80" value={wantPct} onChange={(e) => setWantPct(Number(e.target.value))} className="w-14 rounded-sm border border-stone-300 bg-white px-1 py-0 text-right" aria-label="Target margin %" />%
                        </td>
                        <td className="px-2.5 py-1 text-right">{fmtPrice(pricing.priceFor(wantPct), v.currency)}</td>
                        <td className="px-2.5 py-1 text-right">
                          <button type="button" onClick={() => set("pricePerKg", pricing.priceFor(wantPct) ?? 0)} className={buttonClass("primary", "sm")}>
                            Use
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}
                <label className="block text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">
                    Selling price per kg
                    {pricing && v.pricePerKg > 0 && pricing.marginAt(v.pricePerKg) != null && (
                      <span className={cx("ml-2 normal-case", pricing.marginAt(v.pricePerKg)! >= minPct ? "text-emerald-700" : "text-red-700")}>→ {pricing.marginAt(v.pricePerKg)!.toFixed(1)}% margin</span>
                    )}
                  </span>
                  <div className="mt-1 flex gap-2">
                    <select value={v.currency} onChange={(e) => set("currency", e.target.value)} className="rounded-md border border-stone-300 bg-white px-3 text-sm">
                      {CURRENCIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <input type="number" min="0" step="any" value={v.pricePerKg || ""} onChange={(e) => set("pricePerKg", Number(e.target.value))} className={cx(field, "mt-0 text-lg font-semibold")} placeholder="e.g. 1450" />
                  </div>
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">How will they pay?</span>
                  <select
                    value={v.paymentMode}
                    onChange={(e) => {
                      const m = e.target.value;
                      setV((x) => ({ ...x, paymentMode: m, advancePct: m === "Advance" ? 100 : x.advancePct === 100 ? 0 : x.advancePct }));
                    }}
                    className={field}
                  >
                    <option value="">Choose…</option>
                    {PAYMENT_MODES.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <label className="text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Advance paid</span>
                    <div className="relative">
                      <input type="number" min="0" max="100" value={v.advancePct} onChange={(e) => set("advancePct", Number(e.target.value))} className={cx(field, "pr-8")} />
                      <span className="pointer-events-none absolute right-3 top-1/2 translate-y-[-25%] text-sm text-stone-400">%</span>
                    </div>
                  </label>
                  <label className="text-sm">
                    <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Days to pay</span>
                    <input type="number" min="0" value={v.creditDays} onChange={(e) => set("creditDays", Number(e.target.value))} className={field} />
                  </label>
                </div>
              </div>
              <ProfitCard preview={preview} currency={v.currency} onUseMin={(p) => set("pricePerKg", Math.ceil(p))} />
            </div>
          )}

          {step === 5 && (
            <div className="space-y-5">
              <div className="grid gap-3 lg:grid-cols-2">
                <ReviewTable
                  sections={[
                    {
                      title: "What & when",
                      step: 0,
                      rows: [
                        ["Product", sku ? productLabel(sku, v.blend === "CHICORY" ? v.chicoryPct : 0) : ""],
                        ["Per month", v.qtyPerMonth ? tonnes(v.qtyPerMonth) : ""],
                        ["Months", orderMonths.length ? `${monthLabel(orderMonths[0])} – ${monthLabel(orderMonths.at(-1)!)}` : ""],
                        ["Total", totalT ? tonnes(totalT) : ""],
                      ],
                    },
                    {
                      title: "Customer",
                      step: 1,
                      rows: [
                        ["Company", customer?.name ?? v.newCustomerName],
                        ["Contact", v.contactPerson],
                        ["Type", v.customerType === "NEW" ? "New" : "Repeat"],
                        ["Salesperson", owners.find((o) => o.id === v.bdOwnerId)?.name ?? ""],
                      ],
                    },
                    {
                      title: "Delivery",
                      step: 2,
                      rows: [
                        ["Deliver to", v.destinationPort ? `${v.destinationPort}, ${v.destinationCountry}` : ""],
                        ["Freight", FREIGHT_BASIS[v.freightBasis as keyof typeof FREIGHT_BASIS]],
                        ["Shipping term", v.incoterm],
                      ],
                    },
                  ]}
                  onEdit={setStep}
                />
                <ReviewTable
                  sections={[
                    {
                      title: "Raw coffee",
                      step: 3,
                      rows: [
                        ["Origin", ORIGINS[v.beanOrigin as Origin] ?? ""],
                        ["Grade", v.gbGrade],
                        ["Bean price", v.gbPriceClosed ? `Fixed ₹${v.gbClosedPrice}/kg` : "Market price"],
                      ],
                    },
                    {
                      title: "Price & payment",
                      step: 4,
                      rows: [
                        ["Price", v.pricePerKg ? `${v.currency === "USD" ? "$" : "₹"}${v.pricePerKg}/kg` : ""],
                        ["Payment", v.paymentMode],
                        ["Advance", `${v.advancePct}%`],
                        ["Days to pay", `${v.creditDays}`],
                      ],
                    },
                    {
                      title: "Checks",
                      step: -1,
                      rows: [
                        ["Factory space", shortMonths.length === 0 ? "✓ Fits" : `✕ Full in ${shortMonths.map((m) => monthLabel(m.month)).join(", ")}`],
                        ["Profit", preview?.margin.revenue ? `${profitOk ? "✓" : "!"} ${preview.margin.marginPct.toFixed(1)}% (min ${preview.margin.targetPct}%)` : ""],
                        ["Materials", materialShort.length === 0 ? "✓ Covered" : `${materialShort.length} to buy`],
                      ],
                    },
                  ]}
                  onEdit={setStep}
                />
              </div>

              {materialShort.length > 0 && (
                <div className="border border-amber-300 bg-amber-50 p-2 text-[13px] text-amber-900">
                  <div className="mb-1 font-semibold">Materials to buy</div>
                  <ul className="space-y-0.5">
                    {materialShort.map((m) => (
                      <li key={`${m.key}-${m.month}`}>
                        {m.name}: {m.unit === "kg" ? tonnes(m.short / 1000) : `${Math.round(m.short).toLocaleString("en-IN")} ${m.unit}`} short for {monthLabel(m.month)}
                        {!m.canArriveInTime && <b>, can&apos;t arrive before {monthLabel(m.earliestArrival)}</b>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {shortMonths.length > 0 && (
                <label className="block text-sm">
                  <span className="font-semibold text-red-800">The factory is full, why should this go ahead? (asks the COO to make room)</span>
                  <textarea rows={2} value={v.spillOverride} onChange={(e) => set("spillOverride", e.target.value)} className={cx(field, "border-red-300")} placeholder="e.g. Strategic customer; we can move the Konkan order a month later" />
                  <Err msg={errors.spillOverride} />
                </label>
              )}
              <label className="block text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Notes for the factory (optional)</span>
                <textarea rows={2} value={v.specNotes} onChange={(e) => set("specNotes", e.target.value)} className={field} placeholder="Moisture, labelling, container type…" />
              </label>
            </div>
          )}

          {/* Footer nav */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)} className="rounded-sm border border-stone-300 px-3 py-1.5 text-[13px] font-medium text-stone-700 hover:bg-stone-50">
                ← Back
              </button>
            )}
            <div className="ml-auto flex gap-2">
              {step === 5 ? (
                <>
                  {!live && (
                    <button type="button" disabled={saving} onClick={() => save("draft")} className="rounded-sm border border-stone-300 px-3 py-1.5 text-[13px] font-medium text-stone-700 hover:bg-stone-50">
                      Save as draft
                    </button>
                  )}
                  <button type="button" disabled={saving} onClick={() => save(live ? "draft" : "submit")} className="rounded-sm bg-brand-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                    {saving ? "Sending…" : live ? "Save changes" : status === "SENT_BACK" ? "Send again for approval →" : "Send for approval →"}
                  </button>
                </>
              ) : (
                <button type="button" disabled={!canGoNext} onClick={() => setStep(step + 1)} className="rounded-sm bg-brand-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:opacity-40">
                  Next: {STEPS[step + 1].title} →
                </button>
              )}
            </div>
          </div>
        </section>
      </div>

      <Summary
        sku={sku ? productLabel(sku, v.blend === "CHICORY" ? v.chicoryPct : 0) : null}
        totalT={totalT}
        months={orderMonths}
        customer={customer?.name ?? v.newCustomerName}
        preview={preview}
        shortMonths={shortMonths.length}
        materialShort={materialShort.length}
        currency={v.currency}
        price={v.pricePerKg}
      />
    </div>
  );
}

function shiftText(from: string, to: string) {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const d = ty * 12 + tm - (fy * 12 + fm);
  return `${Math.abs(d)} month${Math.abs(d) > 1 ? "s" : ""} ${d < 0 ? "earlier" : "later"}`;
}

function AvailabilityPanel({
  avail,
  ready,
  totalT,
  manual,
  onManual,
  onUseSuggestion,
  suggestionLabel,
}: {
  avail: Availability | null;
  ready: boolean;
  totalT: number;
  manual: Record<string, Record<number, number>> | null;
  onManual: (m: Record<string, Record<number, number>> | null) => void;
  onUseSuggestion: () => void;
  suggestionLabel: string | null;
}) {
  if (!ready) return <div className="border border-dashed border-stone-300 p-3 text-center text-[13px] text-stone-500">Pick product, tonnes and months to check availability.</div>;
  if (!avail) return <div className="border border-stone-300 bg-stone-50 p-3 text-center text-[13px] text-stone-500">Checking the production lines…</div>;
  const short = avail.perMonth.filter((m) => m.short > 0);
  const editing = !!manual;
  const lineCols = avail.capable;
  const startManual = () => onManual(Object.fromEntries(avail.perMonth.map((m) => [m.month, Object.fromEntries(m.lines.map((l) => [l.lineId, m.proposal.find((p) => p.lineId === l.lineId)?.quantityMt ?? 0]))])));

  return (
    <div className={cx("border", short.length ? "border-red-300" : "border-emerald-300")}>
      <div className={cx("flex flex-wrap items-center gap-3 px-2.5 py-1.5", short.length ? "bg-red-50" : "bg-emerald-50")}>
        <span className={cx("text-[13px] font-semibold", short.length ? "text-red-800" : "text-emerald-800")}>
          {short.length ? `✕ Not available in ${short.length} month${short.length > 1 ? "s" : ""}` : `✓ Available, all ${tonnes(totalT)} can be made`}
        </span>
        <button type="button" onClick={() => (editing ? onManual(null) : startManual())} className="ml-auto text-xs font-medium text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
          {editing ? "Use automatic split" : "Choose lines myself"}
        </button>
      </div>
      {short.length > 0 && suggestionLabel && (
        <div className="flex flex-wrap items-center gap-2 border-t border-red-200 bg-white px-2.5 py-1.5 text-[13px]">
          Fits in: <b>{suggestionLabel}</b>
          <button type="button" onClick={onUseSuggestion} className={buttonClass("primary", "sm")}>
            Use these months
          </button>
        </div>
      )}
      <table className="tabular w-full border-t border-stone-300 text-[13px]">
        <thead>
          <tr className="bg-stone-100 text-[11px] uppercase tracking-wide text-stone-600">
            <th className="px-2.5 py-1 text-left">Month</th>
            <th className="px-2.5 py-1 text-right">Needed</th>
            {lineCols.map((l) => (
              <th key={l.id} className="px-2.5 py-1 text-right">
                {l.code} <span className="normal-case text-stone-400">free → use</span>
              </th>
            ))}
            <th className="px-2.5 py-1 text-right">Result</th>
          </tr>
        </thead>
        <tbody>
          {avail.perMonth.map((m) => {
            const totalFree = m.lines.reduce((a, l) => a + l.free, 0);
            return (
              <tr key={m.month} className="border-t border-stone-200">
                <td className="px-2.5 py-1 font-medium">{monthLabel(m.month)}</td>
                <td className="px-2.5 py-1 text-right">{tonnes(m.need)}</td>
                {lineCols.map((lc) => {
                  const l = m.lines.find((x) => x.lineId === lc.id);
                  if (!l) return <td key={lc.id} />;
                  const planned = manual?.[m.month]?.[l.lineId] ?? m.proposal.find((p) => p.lineId === l.lineId)?.quantityMt ?? 0;
                  return (
                    <td key={lc.id} className="px-2.5 py-1 text-right">
                      <span className="text-stone-500">{tonnes(l.free)}</span>
                      <span className="mx-1 text-stone-300">→</span>
                      {editing ? (
                        <input
                          type="number"
                          min="0"
                          value={planned || ""}
                          onChange={(e) => onManual({ ...manual!, [m.month]: { ...manual![m.month], [l.lineId]: Number(e.target.value) } })}
                          className={cx("w-14 rounded-sm border px-1 py-0 text-right", planned > l.free + 0.05 ? "border-red-400 text-red-700" : "border-stone-300")}
                          aria-label={`${l.code} tonnes in ${monthLabel(m.month)}`}
                        />
                      ) : (
                        <b className={planned > 0 ? "text-brand-800" : "text-stone-300"}>{planned > 0 ? tonnes(planned) : "–"}</b>
                      )}
                    </td>
                  );
                })}
                <td className={cx("px-2.5 py-1 text-right font-semibold", m.short > 0 && !editing ? "text-red-700" : "text-emerald-700")}>{m.short > 0 && !editing ? `short ${tonnes(m.short)}` : totalFree >= m.need ? "✓ fits" : "check"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProfitCard({ preview, currency, onUseMin }: { preview: Preview | null; currency: string; onUseMin: (p: number) => void }) {
  if (!preview || !preview.margin.revenue) return <div className="border border-dashed border-stone-300 p-3 text-center text-[13px] text-stone-500">Enter a price to see the profit.</div>;
  const m = preview.margin;
  const ok = m.marginPct >= m.targetPct;
  const sym = currency === "USD" ? "$" : "₹";
  return (
    <div className="border border-stone-300">
      <div className={cx("flex items-baseline justify-between px-2.5 py-1.5", ok ? "bg-emerald-50" : "bg-red-50")}>
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Profit</span>
        <span className={cx("text-lg font-bold", ok ? "text-emerald-700" : "text-red-700")}>{m.marginPct.toFixed(1)}%</span>
      </div>
      <table className="tabular w-full text-[13px]">
        <tbody>
          <tr className="border-t border-stone-200">
            <td className="px-2.5 py-1 text-stone-600">Sales value</td>
            <td className="px-2.5 py-1 text-right">{formatInr(m.revenue)}</td>
          </tr>
          <tr className="border-t border-stone-200">
            <td className="px-2.5 py-1 text-stone-600">Profit</td>
            <td className="px-2.5 py-1 text-right font-semibold">{formatInr(m.totalMargin)}</td>
          </tr>
          <tr className="border-t border-stone-200">
            <td className="px-2.5 py-1 text-stone-600">Minimum allowed</td>
            <td className="px-2.5 py-1 text-right">{m.targetPct}%</td>
          </tr>
          {preview.minPrice && (
            <tr className="border-t border-stone-200">
              <td className="px-2.5 py-1 text-stone-600">Min price for {m.targetPct}%</td>
              <td className="px-2.5 py-1 text-right">
                <b>
                  {sym}
                  {preview.minPrice.toLocaleString("en-IN", { maximumFractionDigits: currency === "USD" ? 2 : 0 })}/kg
                </b>
                {!ok && (
                  <button type="button" onClick={() => onUseMin(preview.minPrice!)} className={cx(buttonClass("primary", "sm"), "ml-2")}>
                    Use
                  </button>
                )}
              </td>
            </tr>
          )}
          <tr className="border-t border-stone-300 bg-stone-100 text-[11px] uppercase tracking-wide text-stone-600">
            <td className="px-2.5 py-1" colSpan={2}>
              Per kg
            </td>
          </tr>
          <tr className="border-t border-stone-200">
            <td className="px-2.5 py-0.5 text-stone-600">Selling price</td>
            <td className="px-2.5 py-0.5 text-right">₹{Math.round(preview.priceInrPerKg).toLocaleString("en-IN")}</td>
          </tr>
          {preview.costLines.map((c) => (
            <tr key={c.label} className="border-t border-stone-100">
              <td className="px-2.5 py-0.5 text-stone-600">− {c.label}</td>
              <td className="px-2.5 py-0.5 text-right">₹{Math.round(c.perKg).toLocaleString("en-IN")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Review: every field on its own row, grouped by step; empty fields show "Missing" in red.
function ReviewTable({ sections, onEdit }: { sections: { title: string; step: number; rows: [string, string][] }[]; onEdit: (step: number) => void }) {
  return (
    <table className="w-full border border-stone-300 text-[13px]">
      <tbody>
        {sections.map((sec) => (
          <Fragment key={sec.title}>
            <tr className="bg-stone-100">
              <th className="px-2.5 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-700">{sec.title}</th>
              <th className="px-2.5 py-1 text-right">
                {sec.step >= 0 && (
                  <button type="button" onClick={() => onEdit(sec.step)} className="text-xs font-medium normal-case text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-brand-600">
                    Edit
                  </button>
                )}
              </th>
            </tr>
            {sec.rows.map(([k, val]) => (
              <tr key={k}>
                <td className="w-36 px-2.5 py-1 text-stone-500">{k}</td>
                <td className={cx("px-2.5 py-1", !val ? "font-semibold text-red-700" : val.startsWith("✕") ? "font-semibold text-red-700" : val.startsWith("!") ? "text-amber-800" : val.startsWith("✓") ? "text-emerald-700" : "text-stone-900")}>
                  {val || "Missing"}
                </td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function Summary({
  sku,
  totalT,
  months,
  customer,
  preview,
  shortMonths,
  materialShort,
  currency,
  price,
}: {
  sku: string | null;
  totalT: number;
  months: string[];
  customer: string;
  preview: Preview | null;
  shortMonths: number;
  materialShort: number;
  currency: string;
  price: number;
}) {
  const m = preview?.margin;
  const rows: [string, React.ReactNode, string?][] = [
    ["Product", sku ?? "–"],
    ["Quantity", totalT ? `${tonnes(totalT)} · ${months.length} mo` : "–"],
    ["Customer", customer || "–"],
    ["Price", price ? `${currency === "USD" ? "$" : "₹"}${price.toLocaleString("en-IN")}/kg` : "–"],
    ["Value", m?.revenue ? formatInr(m.revenue) : "–"],
    ["Profit", m?.revenue ? `${m.marginPct.toFixed(1)}%` : "–", !m?.revenue ? "" : m.marginPct >= m.targetPct ? "text-emerald-700" : "text-red-700"],
    ["Factory space", !totalT ? "–" : shortMonths ? `✕ full in ${shortMonths} mo` : "✓ fits", !totalT ? "" : shortMonths ? "text-red-700" : "text-emerald-700"],
    ["Materials", !preview?.materials.length ? "–" : materialShort ? `${materialShort} to buy` : "✓ covered", !preview?.materials.length ? "" : materialShort ? "text-amber-700" : "text-emerald-700"],
  ];
  return (
    <aside className="xl:sticky xl:top-4 xl:self-start">
      <div className="rounded-md border border-stone-300 bg-white">
        <div className="border-b border-stone-300 bg-stone-100 px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-stone-700">Order summary</div>
        <table className="tabular w-full text-[13px]">
          <tbody>
            {rows.map(([k, val, cls]) => (
              <tr key={k} className="border-b border-stone-200 last:border-0">
                <th className="w-28 bg-stone-50 px-2.5 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500">{k}</th>
                <td className={cx("px-2.5 py-1 font-medium text-stone-900", cls)}>{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </aside>
  );
}
