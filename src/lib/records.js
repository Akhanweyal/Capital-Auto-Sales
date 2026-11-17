/* ---------- Vehicle files: everything the dealership holds on one vehicle ----------
   Va. Code § 46.2-1529 has dealers keep their records — purchases, sales,
   trades, titles, odometer statements, safety inspections — for five years,
   in a form that can be retrieved systematically. The data already exists
   in four places (the car, its sale/buyer's order, the document archive and
   the test-drive log); this gathers it per vehicle. A vehicle is identified
   by its VIN, so its file survives the car being removed from inventory, a
   duplicate listing, or a document that was filed without the car's id. */

export const RETENTION_YEARS = 5;

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
export const vinKey = (v) => {
  const s = String(v || "").trim().toUpperCase();
  return VIN_RE.test(s) ? s : "";
};

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (v) => (v ? String(v).slice(0, 10) : "");

// Five years from the sale date. The statute doesn't spell out the starting
// point, so this is the cautious reading; the screen says to confirm it.
export function keepUntil(date, years = RETENTION_YEARS) {
  const d = new Date(`${day(date)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setFullYear(d.getFullYear() + years);
  return iso(d);
}

const carTitle = (c) => `${c.year || ""} ${c.make || ""} ${c.model || ""}${c.trim ? " " + c.trim : ""}`.trim();
const saleTitle = (s) => {
  const v = s.vehicle || {};
  return `${v.year || ""} ${v.make || ""} ${v.model || ""}${v.trim ? " " + v.trim : ""}`.trim();
};

export function buildVehicleRecords({ cars = [], sales = [], documents = [], drives = [] }) {
  const recs = new Map();
  const carKey = new Map();
  const saleKey = new Map();
  const get = (key) => {
    if (!recs.has(key)) recs.set(key, { key, vin: "", cars: [], sales: [], docs: [], drives: [] });
    return recs.get(key);
  };

  for (const c of cars) {
    const k = vinKey(c.vin) || `car:${c.id}`;
    carKey.set(c.id, k);
    const r = get(k);
    r.cars.push(c);
    if (vinKey(c.vin)) r.vin = vinKey(c.vin);
  }
  for (const s of sales) {
    const v = vinKey(s.vehicle && s.vehicle.vin);
    const k = (s.car_id && carKey.get(s.car_id)) || v || (s.car_id ? `car:${s.car_id}` : `sale:${s.id}`);
    saleKey.set(s.id, k);
    const r = get(k);
    r.sales.push(s);
    if (v && !r.vin) r.vin = v;
  }
  for (const d of documents) {
    const k =
      (d.car_id && carKey.get(d.car_id)) ||
      vinKey(d.vin) ||
      (d.sale_id && saleKey.get(d.sale_id)) ||
      (d.car_id ? `car:${d.car_id}` : "unlinked");
    const r = get(k);
    r.docs.push(d);
    if (vinKey(d.vin) && !r.vin) r.vin = vinKey(d.vin);
  }
  for (const t of drives) {
    const k = (t.car_id && carKey.get(t.car_id)) || vinKey(t.vin) || (t.car_id ? `car:${t.car_id}` : "unlinked");
    const r = get(k);
    r.drives.push(t);
    if (vinKey(t.vin) && !r.vin) r.vin = vinKey(t.vin);
  }

  const out = [];
  for (const r of recs.values()) {
    const byNewest = (a, b) => String(b.created_at || b.createdAt || "").localeCompare(String(a.created_at || a.createdAt || ""));
    r.cars.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    r.car = r.cars[0] || null;
    r.sales.sort((a, b) => String(b.sale_date || "").localeCompare(String(a.sale_date || "")));
    r.docs.sort(byNewest);
    r.drives.sort((a, b) => String(b.out_at || "").localeCompare(String(a.out_at || "")));

    const finalized = r.sales.filter((s) => s.finalized);
    const soldFlag = r.cars.some((c) => c.sold);
    r.saleDate = finalized.length ? day(finalized[0].sale_date) : "";
    r.keepUntil = r.saleDate ? keepUntil(r.saleDate) : "";
    r.buyer = (finalized[0] && finalized[0].buyer && finalized[0].buyer.name) || "";

    if (r.key === "unlinked") r.status = "unlinked";
    else if (finalized.length || soldFlag) r.status = "sold";
    else if (r.cars.length) r.status = "stock";
    else r.status = "removed";

    r.label =
      r.key === "unlinked"
        ? "Not linked to a vehicle"
        : (r.car && carTitle(r.car)) ||
          (r.sales[0] && saleTitle(r.sales[0])) ||
          (r.docs.find((d) => d.vehicle) || {}).vehicle ||
          (r.drives.find((t) => t.vehicle) || {}).vehicle ||
          "Vehicle";
    r.activity = [
      ...r.docs.map((d) => day(d.created_at)),
      ...r.sales.map((s) => day(s.sale_date)),
      ...r.drives.map((t) => day(t.out_at)),
      ...r.cars.map((c) => (c.createdAt ? day(new Date(c.createdAt).toISOString()) : "")),
    ]
      .filter(Boolean)
      .sort()
      .pop() || "";
    out.push(r);
  }
  out.sort((a, b) => b.activity.localeCompare(a.activity));
  return out;
}

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const STATUS_TEXT = { sold: "Sold", stock: "In inventory", removed: "Removed from inventory", unlinked: "Not linked" };

export function recordsToCsv(records) {
  const header = ["Vehicle", "VIN", "Status", "Sale date", "Buyer", "Keep until", "Documents", "Test drives", "Sale records"];
  const rows = records.map((r) => [r.label, r.vin, STATUS_TEXT[r.status] || r.status, r.saleDate, r.buyer, r.keepUntil, r.docs.length, r.drives.length, r.sales.length]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export { STATUS_TEXT };
