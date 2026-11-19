import { supabase } from "./db.js";

/* Repair-shop side of the business: work tickets, shop money in/out, monthly
   income per shop. Dealer-inventory tickets are tied to a car in inventory so
   the real recon cost lands on that car; outside-customer tickets are income. */

export const DEFAULT_SETTINGS = {
  laborRate: 100,
  taxRate: 6,
  shops: [
    { id: "s1", name: "Shop 1 · Rental", arrangement: "Rented to tenant mechanic", ourShare: 0 },
    { id: "s2", name: "Shop 2 · Shared Mechanic", arrangement: "Shared with mechanic", ourShare: 50 },
    { id: "s3", name: "Shop 3 · Heavy Duty", arrangement: "Dealership-run", ourShare: 100 },
    { id: "s4", name: "Shop 4 · Body Shop", arrangement: "Dealership-run", ourShare: 100 },
  ],
};

export const STATUSES = [
  ["open", "Open"],
  ["progress", "In progress"],
  ["parts", "Waiting on parts"],
  ["ready", "Ready"],
  ["closed", "Closed"],
  ["void", "Void"],
];
export const STATUS_LABEL = Object.fromEntries(STATUSES);
export const LINE_KINDS = [
  ["labor", "Labor"],
  ["part", "Part"],
  ["sublet", "Sublet"],
  ["fee", "Fee"],
];
export const EXP_CATS = [
  "Rent / lease",
  "Utilities",
  "Tools & equipment",
  "Shop supplies",
  "Parts (stock)",
  "Payroll",
  "Insurance",
  "Repairs to shop",
  "Disposal / environmental",
  "Other",
];
export const INC_CATS = ["Bay rent", "Scrap / core return", "Warranty reimbursement", "Other income"];

// The boxes a mechanic ticks on the printed ticket.
export const SERVICE_TYPES = [
  "Oil & filter change",
  "Brakes",
  "Tires / alignment",
  "Engine",
  "Transmission",
  "A/C & heating",
  "Electrical / battery",
  "Suspension / steering",
  "Exhaust",
  "Cooling system",
  "Diagnostic",
  "State inspection",
  "Body / paint",
  "Glass",
  "Detail / clean-up",
  "Other",
];

export const n2 = (v) => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};
const round2 = (x) => Math.round(x * 100) / 100;

/* ---------- money math (pure, unit-tested) ---------- */
export function ticketTotals(t) {
  const r = { labor: 0, parts: 0, sublet: 0, fees: 0, partsCost: 0, subletCost: 0, tax: 0, sales: 0, total: 0, paid: n2(t.paidAmount), balance: 0 };
  (t.lines || []).forEach((l) => {
    const price = n2(l.qty) * n2(l.unit);
    const cost = n2(l.qty) * n2(l.cost);
    if (l.kind === "labor") r.labor += price;
    else if (l.kind === "part") {
      r.parts += price;
      r.partsCost += cost;
    } else if (l.kind === "sublet") {
      r.sublet += price;
      r.subletCost += cost;
    } else r.fees += price;
  });
  r.tax = Math.round(r.parts * n2(t.taxRate)) / 100;
  r.sales = r.labor + r.parts + r.sublet + r.fees;
  r.total = r.sales + r.tax;
  r.balance = t.source === "outside" ? Math.max(0, r.total - r.paid) : 0;
  return r;
}

const shareOf = (settings, shopId) => {
  const s = settings.shops.find((x) => x.id === shopId);
  return n2(s ? s.ourShare : 100) / 100;
};

// What a dealer-inventory job really cost us: parts + sublet at our cost, plus
// the part of labor that goes to the mechanic under that shop's arrangement.
export function dealerCost(t, settings) {
  const r = ticketTotals(t);
  return round2(r.partsCost + r.subletCost + r.labor * (1 - shareOf(settings, t.shop)));
}

export function periodReport(tickets, ledger, settings, from, to) {
  const ids = [...settings.shops.map((s) => s.id), "gen"];
  const rows = Object.fromEntries(
    ids.map((id) => [id, { id, dCount: 0, oCount: 0, sales: 0, tax: 0, cost: 0, mech: 0, dealerBilled: 0, dealerCost: 0, unpaid: 0, income: 0, spend: 0, net: 0 }])
  );
  tickets.forEach((t) => {
    if (t.status === "void" || !t.date || t.date < from || t.date > to) return;
    const row = rows[t.shop] || rows.gen;
    const r = ticketTotals(t);
    const mech = r.labor * (1 - shareOf(settings, t.shop));
    if (t.source === "dealer") {
      row.dCount++;
      row.dealerBilled += r.sales;
      row.dealerCost += r.partsCost + r.subletCost + mech;
    } else {
      row.oCount++;
      row.sales += r.sales;
      row.tax += r.tax;
      row.cost += r.partsCost + r.subletCost;
      row.mech += mech;
      row.unpaid += r.balance;
    }
  });
  ledger.forEach((x) => {
    if (!x.date || x.date < from || x.date > to) return;
    const row = rows[x.shop] || rows.gen;
    if (x.kind === "income") row.income += n2(x.amount);
    else row.spend += n2(x.amount);
  });
  const list = ids.map((id) => rows[id]).filter((r) => r.id !== "gen" || r.income || r.spend);
  list.forEach((r) => {
    r.net = r.sales - r.cost - r.mech + r.income - r.spend - r.dealerCost;
  });
  const tot = { dCount: 0, oCount: 0, sales: 0, tax: 0, cost: 0, mech: 0, dealerBilled: 0, dealerCost: 0, unpaid: 0, income: 0, spend: 0, net: 0 };
  list.forEach((r) => Object.keys(tot).forEach((k) => (tot[k] += r[k])));
  return { from, to, list, tot };
}

const pad = (n) => String(n).padStart(2, "0");
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// One row per month of a year: what each shop made, and the total.
export function monthlyTable(tickets, ledger, settings, year) {
  return MONTH_NAMES.map((name, i) => {
    const from = `${year}-${pad(i + 1)}-01`;
    const last = new Date(year, i + 1, 0).getDate();
    const to = `${year}-${pad(i + 1)}-${pad(last)}`;
    const rep = periodReport(tickets, ledger, settings, from, to);
    return { month: i + 1, name, from, to, rep, byShop: Object.fromEntries(rep.list.map((r) => [r.id, r.net])) };
  });
}

// Real shop cost of each inventory car, keyed by car id.
export function reconByCar(tickets, settings) {
  const out = {};
  tickets.forEach((t) => {
    if (t.source !== "dealer" || t.status === "void" || !t.carId) return;
    const g = out[t.carId] || (out[t.carId] = { cost: 0, billed: 0, tickets: [] });
    g.cost = round2(g.cost + dealerCost(t, settings));
    g.billed = round2(g.billed + ticketTotals(t).sales);
    g.tickets.push(t.num);
  });
  return out;
}

export function nextTicketNumber(tickets) {
  let max = 1000;
  tickets.forEach((t) => {
    const m = /(\d+)$/.exec(t.num || "");
    if (m) max = Math.max(max, +m[1]);
  });
  return "T-" + (max + 1);
}

/* ---------- database ---------- */
const ticketFromRow = (r) => ({
  id: r.id,
  num: r.num,
  date: r.ticket_date,
  shop: r.shop,
  source: r.source,
  status: r.status,
  carId: r.car_id || null,
  customer: { name: r.customer_name || "", phone: r.customer_phone || "" },
  vehicle: { year: "", make: "", model: "", vin: "", miles: "", ...(r.vehicle || {}) },
  concern: r.concern || "",
  services: Array.isArray(r.services) ? r.services : [],
  tech: r.tech || "",
  lines: Array.isArray(r.lines) ? r.lines : [],
  taxRate: n2(r.tax_rate),
  paidAmount: n2(r.paid_amount),
  paidMethod: r.paid_method || "",
  notes: r.notes || "",
  closedAt: r.closed_at || null,
  updatedBy: r.updated_by || "",
});
const ticketToRow = (t) => ({
  num: t.num,
  ticket_date: t.date,
  shop: t.shop,
  source: t.source,
  status: t.status,
  car_id: t.source === "dealer" ? t.carId || null : null,
  customer_name: t.source === "outside" ? t.customer.name : "",
  customer_phone: t.source === "outside" ? t.customer.phone : "",
  vehicle: t.vehicle,
  concern: t.concern,
  services: t.services,
  tech: t.tech,
  lines: t.lines,
  tax_rate: t.taxRate,
  paid_amount: t.source === "outside" ? n2(t.paidAmount) : 0,
  paid_method: t.source === "outside" ? t.paidMethod || "" : "",
  notes: t.notes,
  closed_at: t.status === "closed" ? t.closedAt || new Date().toISOString() : t.closedAt || null,
});

// True when the shop tables haven't been created yet in Supabase.
export const tablesMissing = (e) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /shop_(tickets|ledger|settings)/.test(e.message || ""));

export async function fetchTickets() {
  const { data, error } = await supabase.from("shop_tickets").select("*").order("ticket_date", { ascending: false });
  if (error) throw error;
  return (data || []).map(ticketFromRow);
}
export async function saveTicket(t) {
  const row = ticketToRow(t);
  const q = t.id ? supabase.from("shop_tickets").update(row).eq("id", t.id) : supabase.from("shop_tickets").insert(row);
  const { data, error } = await q.select().single();
  if (error) throw error;
  return ticketFromRow(data);
}
export async function deleteTicket(id) {
  const { error } = await supabase.from("shop_tickets").delete().eq("id", id);
  if (error) throw error;
}

const ledgerFromRow = (r) => ({
  id: r.id,
  kind: r.kind,
  date: r.entry_date,
  shop: r.shop,
  category: r.category || "",
  amount: n2(r.amount),
  method: r.method || "",
  vendor: r.vendor || "",
  note: r.note || "",
});
export async function fetchLedger() {
  const { data, error } = await supabase.from("shop_ledger").select("*").order("entry_date", { ascending: false });
  if (error) throw error;
  return (data || []).map(ledgerFromRow);
}
export async function addLedger(e) {
  const { data, error } = await supabase
    .from("shop_ledger")
    .insert({ kind: e.kind, entry_date: e.date, shop: e.shop, category: e.category, amount: e.amount, method: e.method, vendor: e.vendor, note: e.note })
    .select()
    .single();
  if (error) throw error;
  return ledgerFromRow(data);
}
export async function deleteLedger(id) {
  const { error } = await supabase.from("shop_ledger").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchSettings() {
  const { data, error } = await supabase.from("shop_settings").select("data").eq("id", "main").maybeSingle();
  if (error) throw error;
  const d = data && data.data;
  if (d && Array.isArray(d.shops) && d.shops.length) {
    return { laborRate: n2(d.laborRate) || DEFAULT_SETTINGS.laborRate, taxRate: d.taxRate == null ? DEFAULT_SETTINGS.taxRate : n2(d.taxRate), shops: d.shops };
  }
  return DEFAULT_SETTINGS;
}
export async function saveSettings(s) {
  const { error } = await supabase.from("shop_settings").upsert({ id: "main", data: s });
  if (error) throw error;
}

// Real shop cost of one inventory car (used by the car and sale forms).
export async function fetchCarRecon(carId) {
  const [tickets, settings] = await Promise.all([
    supabase.from("shop_tickets").select("*").eq("car_id", carId).eq("source", "dealer"),
    fetchSettings().catch(() => DEFAULT_SETTINGS),
  ]);
  if (tickets.error) throw tickets.error;
  const list = (tickets.data || []).map(ticketFromRow);
  return reconByCar(list.map((t) => ({ ...t, carId })), settings)[carId] || null;
}
