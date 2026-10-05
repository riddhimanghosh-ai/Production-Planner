import { loadCapacityState } from "@/lib/capacity";
import { addDays, addMonths, currentMonth, isoDate, monthRange, shipmentTonnes, validGrade, type ApproverRole } from "@/lib/domain";
import { inventoryProjection, shortages } from "@/lib/inventory";
import { describeMaterial } from "@/lib/procurement";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { decide, evaluateOrder, planAvailability, saveOrder, suggestLine, type OrderInput, type Viewer } from "@/lib/workflow";
import { nextId, store, type Store } from "./store";

const M = (n: number) => addMonths(currentMonth(), n);
const monthsAgo = isoDate(addDays(new Date(), -180));

const USERS = [
  { name: "Rohan Mehta", role: "BD_EXEC", email: "rohan.mehta@slncoffee.example" },
  { name: "Priya Nair", role: "BD_EXEC", email: "priya.nair@slncoffee.example" },
  { name: "Karan Shah", role: "BD_EXEC", email: "karan.shah@slncoffee.example" },
  { name: "Sales head", role: "BD_HEAD", email: "sales.head@slncoffee.example" },
  { name: "CFO", role: "CFO", email: "cfo@slncoffee.example" },
  { name: "COO", role: "COO", email: "coo@slncoffee.example" },
  { name: "Production planner", role: "PLANNER", email: "planner@slncoffee.example" },
  { name: "Procurement", role: "PROCUREMENT", email: "procurement@slncoffee.example" },
  { name: "Admin", role: "ADMIN", email: "admin@slncoffee.example" },
] as const;

const SKUS = [
  { code: "Spray-dried · Pure · Bulk bags", name: "Spray-dried, pure coffee, 25 kg bulk bags", productType: "SD", blend: "PURE", packFormat: "BULK", packSizeKg: 25 },
  { code: "Spray-dried · Chicory · Bulk bags", name: "Spray-dried, coffee + chicory, 25 kg bulk bags", productType: "SD", blend: "CHICORY", packFormat: "BULK", packSizeKg: 25 },
  { code: "Spray-dried · Pure · Glass jars", name: "Spray-dried, pure coffee, 100 g glass jars", productType: "SD", blend: "PURE", packFormat: "GLASS", packSizeKg: 0.1 },
  { code: "Spray-dried · Pure · Cans", name: "Spray-dried, pure coffee, 200 g cans", productType: "SD", blend: "PURE", packFormat: "CAN", packSizeKg: 0.2 },
  { code: "Spray-dried · Chicory · Cans", name: "Spray-dried, coffee + chicory, 200 g cans", productType: "SD", blend: "CHICORY", packFormat: "CAN", packSizeKg: 0.2 },
  { code: "Agglomerated · Pure · Bulk bags", name: "Agglomerated, pure coffee, 25 kg bulk bags", productType: "AG", blend: "PURE", packFormat: "BULK", packSizeKg: 25 },
  { code: "Agglomerated · Pure · Glass jars", name: "Agglomerated, pure coffee, 100 g glass jars", productType: "AG", blend: "PURE", packFormat: "GLASS", packSizeKg: 0.1 },
  { code: "Agglomerated · Chicory · Glass jars", name: "Agglomerated, coffee + chicory, 100 g glass jars", productType: "AG", blend: "CHICORY", packFormat: "GLASS", packSizeKg: 0.1 },
  { code: "Agglomerated · Pure · Cans", name: "Agglomerated, pure coffee, 200 g cans", productType: "AG", blend: "PURE", packFormat: "CAN", packSizeKg: 0.2 },
  { code: "Freeze-dried · Pure · Bulk bags", name: "Freeze-dried, pure coffee, 25 kg bulk bags", productType: "FDC", blend: "PURE", packFormat: "BULK", packSizeKg: 25 },
  { code: "Freeze-dried · Pure · Glass jars", name: "Freeze-dried, pure coffee, 100 g glass jars", productType: "FDC", blend: "PURE", packFormat: "GLASS", packSizeKg: 0.1 },
];

const TERMS = {
  LC: { paymentMode: "LC at sight", advancePct: 0, creditDays: 7 },
  ADV: { paymentMode: "Advance", advancePct: 100, creditDays: 0 },
  OA30: { paymentMode: "Open account", advancePct: 10, creditDays: 30 },
  OA60: { paymentMode: "Open account", advancePct: 0, creditDays: 60 },
  OA90: { paymentMode: "Open account", advancePct: 0, creditDays: 90 },
  CAD: { paymentMode: "CAD", advancePct: 0, creditDays: 20 },
};

type Flow = "draft" | "pending" | "committed" | { approve: ApproverRole[] } | { sendBack: ApproverRole; comment: string } | { reject: ApproverRole; comment: string };

type SeedOrder = {
  customer: string;
  city: string;
  country: string;
  contact: string;
  owner: string;
  sku: string;
  chicoryPct?: number;
  months: [number, number];
  totalMt: number;
  price: number;
  origin: "VIETNAM" | "BRAZIL" | "INDIA";
  grade: string;
  gbClosed?: number;
  terms: keyof typeof TERMS;
  incoterm: string;
  freight: "SELLER" | "BUYER";
  notes?: string;
  flow: Flow;
};

const ORDERS: SeedOrder[] = [
  {
    customer: "Nordic Roast AB",
    city: "Gothenburg",
    country: "Sweden",
    contact: "Erik Lindqvist",
    owner: "Rohan Mehta",
    sku: "Spray-dried · Pure · Bulk bags",
    months: [2, 11],
    totalMt: 150,
    price: 1390,
    origin: "VIETNAM",
    grade: "Robusta Cherry AA",
    gbClosed: 385,
    terms: "LC",
    incoterm: "FOB",
    freight: "BUYER",
    flow: "committed",
  },
  {
    customer: "Kaffee Partner GmbH",
    city: "Hamburg",
    country: "Germany",
    contact: "Anna Weber",
    owner: "Priya Nair",
    sku: "Agglomerated · Pure · Glass jars",
    months: [3, 8],
    totalMt: 72,
    price: 1880,
    origin: "BRAZIL",
    grade: "Arabica Plantation A",
    terms: "CAD",
    incoterm: "CIF",
    freight: "SELLER",
    flow: "committed",
  },
  {
    customer: "Al Rashid Trading LLC",
    city: "Jebel Ali",
    country: "United Arab Emirates",
    contact: "Omar Al Rashid",
    owner: "Karan Shah",
    sku: "Spray-dried · Chicory · Cans",
    chicoryPct: 30,
    months: [2, 7],
    totalMt: 90,
    price: 1250,
    origin: "INDIA",
    grade: "Robusta Parchment AB",
    gbClosed: 360,
    terms: "OA30",
    incoterm: "CIF",
    freight: "SELLER",
    flow: "committed",
  },
  {
    customer: "Pacific Beverage Importers",
    city: "Long Beach",
    country: "United States",
    contact: "Maria Santos",
    owner: "Rohan Mehta",
    sku: "Agglomerated · Pure · Bulk bags",
    months: [4, 9],
    totalMt: 120,
    price: 1520,
    origin: "VIETNAM",
    grade: "Robusta Cherry AA",
    terms: "OA60",
    incoterm: "CIF",
    freight: "SELLER",
    flow: "committed",
  },
  {
    customer: "Baltic Food Imports",
    city: "Gdańsk",
    country: "Poland",
    contact: "Piotr Nowak",
    owner: "Priya Nair",
    sku: "Spray-dried · Chicory · Bulk bags",
    chicoryPct: 40,
    months: [3, 8],
    totalMt: 90,
    price: 1080,
    origin: "INDIA",
    grade: "Robusta Screen 16",
    gbClosed: 355,
    terms: "LC",
    incoterm: "FOB",
    freight: "BUYER",
    flow: "committed",
  },
  {
    customer: "Tokyo Fine Foods KK",
    city: "Tokyo",
    country: "Japan",
    contact: "Yuki Sato",
    owner: "Priya Nair",
    sku: "Freeze-dried · Pure · Bulk bags",
    months: [2, 10],
    totalMt: 90,
    price: 2460,
    origin: "BRAZIL",
    grade: "Arabica Plantation A",
    terms: "OA30",
    incoterm: "CIF",
    freight: "SELLER",
    flow: "committed",
  },
  {
    customer: "Mitsui Foods KK",
    city: "Yokohama",
    country: "Japan",
    contact: "Kenji Tanaka",
    owner: "Karan Shah",
    sku: "Agglomerated · Chicory · Glass jars",
    chicoryPct: 30,
    months: [5, 7],
    totalMt: 45,
    price: 1480,
    origin: "VIETNAM",
    grade: "Robusta Cherry AA",
    terms: "OA60",
    incoterm: "CIF",
    freight: "SELLER",
    flow: "committed",
  },
  {
    customer: "Levant Coffee Co.",
    city: "Beirut",
    country: "Lebanon",
    contact: "Nadia Haddad",
    owner: "Rohan Mehta",
    sku: "Spray-dried · Pure · Bulk bags",
    months: [6, 11],
    totalMt: 90,
    price: 1450,
    origin: "BRAZIL",
    grade: "Arabica Cherry AB",
    terms: "ADV",
    incoterm: "CIF",
    freight: "SELLER",
    flow: "committed",
  },
  {
    customer: "Ankara Gıda AŞ",
    city: "Mersin",
    country: "Turkey",
    contact: "Mehmet Yılmaz",
    owner: "Karan Shah",
    sku: "Spray-dried · Pure · Bulk bags",
    months: [9, 14],
    totalMt: 180,
    price: 1450,
    origin: "VIETNAM",
    grade: "Robusta Cherry AA",
    terms: "LC",
    incoterm: "FOB",
    freight: "BUYER",
    notes: "Annual contract, monthly liftings. Customer wants the price locked for 6 months.",
    flow: { approve: ["CFO"] },
  },
  {
    customer: "Seoul Beverage Corp",
    city: "Busan",
    country: "South Korea",
    contact: "Ji-ho Park",
    owner: "Rohan Mehta",
    sku: "Agglomerated · Pure · Bulk bags",
    months: [5, 7],
    totalMt: 150,
    price: 1480,
    origin: "VIETNAM",
    grade: "Robusta Cherry AA",
    terms: "OA90",
    incoterm: "CIF",
    freight: "SELLER",
    flow: "pending",
  },
  {
    customer: "Cape Coffee Traders",
    city: "Cape Town",
    country: "South Africa",
    contact: "Thabo Nkosi",
    owner: "Priya Nair",
    sku: "Spray-dried · Pure · Cans",
    months: [8, 11],
    totalMt: 55,
    price: 1680,
    origin: "BRAZIL",
    grade: "Arabica Cherry AB",
    terms: "OA30",
    incoterm: "CIF",
    freight: "SELLER",
    flow: { sendBack: "COO", comment: "Can filling is tight in the first two months, shift those lines to later months or split across SD02." },
  },
  {
    customer: "Caspian Trade House",
    city: "Bandar Abbas",
    country: "Iran",
    contact: "Reza Farahani",
    owner: "Karan Shah",
    sku: "Agglomerated · Pure · Glass jars",
    months: [6, 9],
    totalMt: 40,
    price: 1550,
    origin: "BRAZIL",
    grade: "Arabica Plantation A",
    terms: "OA60",
    incoterm: "CIF",
    freight: "SELLER",
    flow: { reject: "CFO", comment: "Price is below cost at current Brazil bean prices. Re-quote at ₹1,780/kg or switch to Vietnam beans." },
  },
  {
    customer: "Melbourne Brew Supply",
    city: "Melbourne",
    country: "Australia",
    contact: "Olivia Clarke",
    owner: "Rohan Mehta",
    sku: "Spray-dried · Chicory · Cans",
    chicoryPct: 35,
    months: [7, 9],
    totalMt: 45,
    price: 1260,
    origin: "INDIA",
    grade: "Robusta Parchment AB",
    terms: "OA30",
    incoterm: "CIF",
    freight: "SELLER",
    flow: "draft",
  },
];

export function seedStore() {
  const st = store();
  st.settings = DEFAULT_SETTINGS.map((s, i) => ({ ...s, sort: i }));
  st.users = USERS.map((u) => ({ ...u, id: nextId("users") }));
  const userId = (name: string) => st.users.find((u) => u.name === name)!.id;
  const viewerFor = (role: string): Viewer => {
    const u = st.users.find((x) => x.role === role)!;
    return { id: u.id, name: u.name, role: u.role };
  };

  // Three lines; monthly maxima are placeholders until SLN confirms them.
  st.lines = [
    { code: "SD01", name: "Spray-dried, with agglomeration", capacityMt: 45 },
    { code: "SD02", name: "Spray-dried, with agglomeration", capacityMt: 45 },
    { code: "SD03", name: "Spray-dried only, no agglomeration", capacityMt: 35 },
    { code: "FDC", name: "Freeze-dried", capacityMt: 15 },
  ].map((l) => ({ ...l, id: nextId("lines"), active: true, capacityConfirmed: false }));
  const lineId = (code: string) => st.lines.find((l) => l.code === code)!.id;
  st.lineProducts = [
    { lineId: lineId("SD01"), productType: "SD", capacityMt: 30 },
    { lineId: lineId("SD01"), productType: "AG", capacityMt: 15 },
    { lineId: lineId("SD02"), productType: "SD", capacityMt: 15 },
    { lineId: lineId("SD02"), productType: "AG", capacityMt: 30 },
    { lineId: lineId("SD03"), productType: "SD", capacityMt: 35 },
    { lineId: lineId("FDC"), productType: "FDC", capacityMt: 15 },
  ];
  st.capacityOverrides = [{ lineId: lineId("SD03"), month: M(8), capacityMt: 25, note: "Planned maintenance" }];
  st.skus = SKUS.map((s) => ({ ...s, id: nextId("skus"), active: true }));

  for (const o of ORDERS) {
    const ownerId = userId(o.owner);
    const customerId = nextId("customers");
    st.customers.push({ id: customerId, name: o.customer, country: o.country, contactPerson: o.contact, bdOwnerId: ownerId });
    const sku = st.skus.find((s) => s.code === o.sku)!;
    const months = monthRange(M(o.months[0]), M(o.months[1]));
    // Price history: repeat customers bought the same product before, at slightly lower prices.
    if (o.customer !== "Cape Coffee Traders") {
      const history = o.flow === "draft" ? [-16, -10] : [-17, -11, -5];
      history.forEach((ago, i) => {
        const rise = [0.93, 0.96, 0.985][i + (3 - history.length)];
        st.pastSales.push({
          id: nextId("pastSales"),
          customerId,
          date: `${M(ago)}-15`,
          productType: sku.productType,
          blend: sku.blend,
          packFormat: sku.packFormat,
          quantityMt: Math.round((o.totalMt / 3) * 10) / 10,
          pricePerKg: Math.round(o.price * rise),
          currency: "INR",
        });
      });
    }
    // One order = one shipment in one month. Approved customers are on a running contract, so they get
    // separate orders spread across their period; every other flow is a single order for its first month.
    const perMonth = Math.round((o.totalMt / months.length) * 10) / 10;
    const picks = o.flow === "committed" ? [...new Set([months[0], months[Math.floor((months.length - 1) / 2)], months[months.length - 1]])] : [months[0]];
    for (const shipMonth of picks) {
      const shipments = [{ month: shipMonth, quantityMt: perMonth }];
      const needs = shipmentTonnes(shipments);
      const state = loadCapacityState();
      const input: OrderInput = {
        customerId,
        newCustomerName: "",
        customerCountry: o.country,
        contactPerson: o.contact,
        customerType: "REPEAT",
        bdOwnerId: ownerId,
        destinationCountry: o.country,
        destinationPort: o.city,
        incoterm: o.incoterm,
        freightBasis: o.freight,
        gbGrade: validGrade(o.origin, o.grade),
        beanOrigin: o.origin,
        gbPriceClosed: !!o.gbClosed,
        gbClosedPrice: o.gbClosed ?? null,
        ...TERMS[o.terms],
        currency: "INR",
        specNotes: o.notes ?? "",
        spillOverride: "",
        shipments,
        // Split each month across the lines that have room, the same way the order guide does.
        lines: planAvailability(sku.productType, [shipMonth], needs, undefined, sku.blend).perMonth.flatMap((m) => {
          const split = m.proposal.length ? m.proposal.map((p) => ({ ...p })) : [{ lineId: suggestLine(state, sku.productType, m.month)!, quantityMt: 0 }];
          split[0].quantityMt = Math.round((split[0].quantityMt + m.short) * 10) / 10;
          return split.map((p) => ({ skuId: sku.id, chicoryPct: o.chicoryPct ?? 0, month: m.month, quantityMt: p.quantityMt, pricePerKg: o.price, lineId: p.lineId }));
        }),
      };
      const asOf = o.flow === "committed" ? monthsAgo : undefined;
      if (evaluateOrder(input, undefined, asOf).lines.some((l) => l.spill > 0)) {
        input.spillOverride = "Priority customer, requesting COO to rebalance the line mix for this month.";
      }
      const bd: Viewer = { id: ownerId, name: o.owner, role: "BD_EXEC" };
      const id = saveOrder(input, bd, o.flow === "draft" ? "draft" : "submit", undefined, asOf);
      const order = st.orders.find((x) => x.id === id)!;
      if (o.customer === "Cape Coffee Traders") order.customerType = "NEW";

      const f = o.flow;
      if (f === "draft" || f === "pending") continue;
      if (f === "committed") for (const r of ["CFO", "COO"] as const) decide(id, r, "APPROVED", "", viewerFor(r));
      else if ("approve" in f) for (const r of f.approve) decide(id, r, "APPROVED", "", viewerFor(r));
      else if ("sendBack" in f) decide(id, f.sendBack, "SENT_BACK", f.comment, viewerFor(f.sendBack));
      else decide(id, f.reject, "REJECTED", f.comment, viewerFor(f.reject));
    }
  }

  // Stock in the warehouse and purchases already on the way.
  const stock: [string, number][] = [
    ["GB|VIETNAM|Robusta Cherry AA", 180_000],
    ["GB|INDIA|Robusta Parchment AB", 60_000],
    ["GB|INDIA|Robusta Screen 16", 40_000],
    ["GB|BRAZIL|Arabica Plantation A", 15_000],
    ["GB|BRAZIL|Arabica Cherry AB", 10_000],
    ["CHICORY", 45_000],
    ["PM|CARTON|25", 3_000],
    ["PM|JAR|100", 60_000],
    ["PM|LABEL", 80_000],
    ["CAN|200", 120_000],
  ];
  st.inventory = stock.map(([key, onHand]) => ({ key, ...describeMaterial(key), onHand }));
  const po = (materialKey: string, quantity: number, arrivalMonth: string, supplier: string) =>
    st.purchaseOrders.push({ id: nextId("purchaseOrders"), materialKey, quantity, arrivalMonth, supplier, status: "ORDERED", createdBy: "Procurement", createdAt: new Date(), requestId: null });
  po("GB|VIETNAM|Robusta Cherry AA", 250_000, M(2), "Dak Lak Coffee Exports");
  po("GB|VIETNAM|Robusta Cherry AA", 200_000, M(5), "Dak Lak Coffee Exports");
  po("GB|BRAZIL|Arabica Plantation A", 60_000, M(3), "Minas Gerais Traders");
  po("GB|INDIA|Robusta Screen 16", 80_000, M(3), "Coorg Estates");
  po("CAN|200", 250_000, M(2), "Mumbai Can Co.");
  po("PM|CARTON|25", 6_000, M(3), "Pune Packaging");

  // Procurement has already bought for most of the near-term plan; a few gaps are left to show the workflow.
  // Leave exactly two gaps: the jars a planner has already asked for, and the first month of Brazil beans.
  const leaveOpen = new Set([`PM|JAR|100@${M(3)}`]);
  for (let i = 0; i < 120; i++) {
    const gaps = shortages(inventoryProjection()).filter((x) => x.month <= M(12));
    const brazil = gaps.find((x) => x.key === "GB|BRAZIL|Arabica Cherry AB");
    if (brazil && ![...leaveOpen].some((k) => k.startsWith("GB|BRAZIL|Arabica Cherry AB"))) leaveOpen.add(`${brazil.key}@${brazil.month}`);
    const gap = gaps.find((x) => !leaveOpen.has(`${x.key}@${x.month}`));
    if (!gap) break;
    // Buy roughly a quarter at a time, like procurement does.
    const row = inventoryProjection().find((r) => r.key === gap.key)!;
    const nextTwo = [addMonths(gap.month, 1), addMonths(gap.month, 2)].reduce((a, m) => a + (row.cells[m]?.need ?? 0), 0);
    po(gap.key, Math.ceil((gap.short + nextTwo) * 1.05), gap.month, gap.key.startsWith("GB|") ? "Estate & trader contracts" : gap.key.startsWith("CAN|") ? "Mumbai Can Co." : gap.key === "CHICORY" ? "Gujarat Chicory Co." : "Pune Packaging");
  }

  st.purchaseRequests.push({
    id: nextId("purchaseRequests"),
    materialKey: "PM|JAR|100",
    quantity: 150_000,
    neededBy: M(3),
    note: "Glass jars for the Kaffee Partner and Mitsui orders",
    status: "OPEN",
    raisedBy: "Production planner",
    createdAt: new Date(),
    poId: null,
  });
  st.reservations.push({ id: nextId("reservations"), lineId: lineId("SD02"), month: M(10), quantityMt: 20, label: "Expected repeat order, Nordic Roast", productType: "SD", createdBy: "Production planner" });
  seedDailyLogs(st);
}

// Sample shop-floor log for the first month with approved production: ~two weeks of closed days,
// one breakdown with a mid-day capacity drop, one short day, and the latest shift still running.
function seedDailyLogs(st: Store) {
  const approved = new Set(st.orders.filter((o) => o.status === "COMMITTED").map((o) => o.id));
  const slots = st.allocations.filter((a) => approved.has(a.orderId));
  const month = [...new Set(slots.map((a) => a.month))].sort()[0];
  if (!month) return;
  const [y, mo] = month.split("-").map(Number);
  const allDays = Array.from({ length: new Date(y, mo, 0).getDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const working = allDays.filter((d) => new Date(`${d}T00:00:00`).getDay() !== 0);
  const logged = working.slice(0, 7); // about a week and a half in: part of the month still to make
  const planner = "Production planner";
  const at = (d: string, hhmm: string) => new Date(`${d}T${hhmm}:00`);

  for (const line of st.lines) {
    const slot = slots.find((a) => a.lineId === line.id && a.month === month);
    if (!slot) continue;
    const override = st.capacityOverrides.find((o) => o.lineId === line.id && o.month === month);
    const dayCap = Math.round(((override?.capacityMt ?? line.capacityMt) / working.length) * 10) / 10;
    logged.forEach((date, i) => {
      const last = i === logged.length - 1;
      const events = [{ at: at(date, "07:00"), by: planner, capacityT: dayCap, reason: "Day started" }];
      let capacityT = dayCap;
      let madeT: number | null = dayCap;
      if (line.code === "SD02" && i === 4) {
        capacityT = Math.round(dayCap * 0.5 * 10) / 10;
        events.push({ at: at(date, "11:40"), by: planner, capacityT, reason: "Breakdown: spray nozzle blocked, cleaning" });
        madeT = Math.round(dayCap * 0.6 * 10) / 10;
      }
      if (line.code === "SD01" && i === 3) {
        capacityT = Math.round(dayCap * 0.7 * 10) / 10;
        events.push({ at: at(date, "14:15"), by: planner, capacityT, reason: "Material shortage: bulk bags arrived late" });
        madeT = Math.round(dayCap * 0.75 * 10) / 10;
      }
      if (last && line.code === "SD01") madeT = null; // today's shift, still running
      // Two batches a day with lot numbers; one lot on the line's short day is held for a moisture retest.
      const lotNo = (n: number) => `${line.code}-${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}-${String(n).padStart(2, "0")}`;
      const kg = Math.round((madeT ?? capacityT) * 1000);
      const batches = [
        { id: nextId("batches"), lotNo: lotNo(1), start: "07:10", end: "12:30", outputKg: Math.round(kg * 0.52), qc: "RELEASED" as const, moisturePct: 3.4, note: "" },
        {
          id: nextId("batches"),
          lotNo: lotNo(2),
          start: "12:45",
          end: "18:40",
          outputKg: kg - Math.round(kg * 0.52),
          qc: (madeT != null && madeT < dayCap - 0.05 ? "HOLD" : "RELEASED") as "HOLD" | "RELEASED",
          moisturePct: madeT != null && madeT < dayCap - 0.05 ? 4.6 : 3.6,
          note: madeT != null && madeT < dayCap - 0.05 ? "Moisture above 4.5%, retest" : "",
        },
      ];
      st.dayLogs.push({
        id: nextId("dayLogs"),
        lineId: line.id,
        date,
        allocationId: slot.id,
        capacityT,
        lockedAt: at(date, "07:00"),
        lockedBy: planner,
        events,
        madeT,
        closedAt: madeT == null ? null : at(date, "19:00"),
        batches: madeT == null ? [batches[0]] : batches,
      });
      if (madeT != null) slot.producedMt = Math.round(((slot.producedMt ?? 0) + madeT) * 10) / 10;
    });
    slot.producedAt = new Date();
  }
}
