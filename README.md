# SLN Coffee B2B Order & Capacity Tool — visual prototype

A process-first tool for SLN's B2B coffee orders: **take an order → approve it → plan production → buy the materials**.

Next.js 16 · Tailwind. No database: sample data lives in server memory and resets on restart or via **Reset demo data** in the sidebar.

```bash
npm install
npm run dev
```

## The flow

1. **New order** (salesperson) — a six-step guide:
   1. *What & when* — type of coffee (spray-dried / agglomerated / freeze-dried), recipe (pure / with chicory), packing (bulk bags / glass jars / cans), tonnes per month and months. The screen immediately shows whether the lines have space; if not, it suggests the nearest months that fit.
   2. *Customer* · 3. *Delivery* · 4. *Raw coffee* (origin, grade, is the bean price fixed?) · 5. *Price & payment* with live profit and the minimum price for the profit target · 6. *Review* with checks (space, profit, materials) → **Send for approval**.
2. **Orders & approvals** — every order with a progress bar. The *Approvals* tab shows each waiting order with the CFO's money view and the COO's factory view side by side; each approves, sends back (with a comment) or rejects. Both must approve before factory time is locked. The CEO can see everything.
3. **Production calendar** — the three lines down the side, months across. Each box shows tonnes planned vs capacity, the orders in it, reserved time, maintenance, and whether materials are covered. Drag an order to another box (or use *Move to* in the box) to see the impact and move it. Click a box to change that month's capacity, block it for maintenance, reserve time, or **ask procurement to buy** a missing material. *Line setup* sets each line's normal capacity and what it can make.
4. **Inventory & purchasing** — *Needs attention* (planner requests and automatic shortfalls, each with a one-click purchase order), *Stock & coverage* month by month, *Purchases on the way* (mark received), and bean prices (market prices, and fixing the price on orders).

Also: **Profit & costs** (profit per order, quick calculator, cost settings), **Leadership summary**, **Settings** (customers, users, products, lines). Every table exports to Excel.

## Words used in the app

| In the app | Means | Uses a production line? |
|---|---|---|
| Spray-dried / Agglomerated / Freeze-dried | How the liquid coffee is dried | **Yes** |
| Pure coffee / Coffee + chicory | The recipe | No — changes ingredients and cost |
| Bulk bags / Glass jars / Cans | Packing | No — changes packing to buy |
| Green beans | Raw coffee bought from Brazil, Vietnam or India | No — bought by procurement |

## Who's who ("Viewing as")

Salespeople (Rohan Mehta, Priya Nair, Karan Shah) · Sales head · CFO · COO · CEO (view only) · Production planner · Procurement · Admin. **All access** can do everything for demos.

## Assumptions to confirm with SLN

- Three lines: Lines 1–2 make spray-dried or agglomerated, Line 3 spray-dried only; capacities (45 / 45 / 35 t a month) are placeholders. Each line has one monthly capacity shared by everything it makes.
- CFO and COO approve in parallel; a full line needs a reason for the COO before sending.
- Stock, purchase orders, lead times, costs and the 18% minimum profit are sample figures.
- Real logins, email alerts, Excel upload and a database come in the working prototype.
