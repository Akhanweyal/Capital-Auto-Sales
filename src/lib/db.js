import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(URL && KEY);
export const supabase = configured ? createClient(URL, KEY) : null;

const BUCKET = "car-photos";

/* ---------- shaping ---------- */
const fromRow = (r) => ({
  id: r.id,
  year: r.year,
  make: r.make,
  model: r.model,
  trim: r.trim || "",
  price: Number(r.price) || 0,
  mileage: Number(r.mileage) || 0,
  condition: r.condition || "Good",
  description: r.description || "",
  vin: r.vin || "",
  published: !!r.published,
  sold: !!r.sold,
  pending: !!r.pending,
  featured: !!r.featured,
  cover: r.cover_url || "",
  photos: Array.isArray(r.photos) ? r.photos : [],
  stage: r.stage || "intake",
  safetyInspected: !!r.safety_inspected,
  safetyInspectedDate: r.safety_inspected_date || "",
  warrantyType: r.warranty_type || "as_is",
  warrantySystems: r.warranty_systems || "",
  warrantyDuration: r.warranty_duration || "",
  warrantyPctLabor: Number(r.warranty_pct_labor) || 0,
  warrantyPctParts: Number(r.warranty_pct_parts) || 0,
  createdAt: new Date(r.created_at).getTime(),
});

const toRow = (c) => ({
  year: Number(c.year),
  make: c.make,
  model: c.model,
  trim: c.trim || "",
  price: Number(c.price) || 0,
  mileage: Number(c.mileage) || 0,
  condition: c.condition,
  description: c.description || "",
  vin: c.vin || "",
  published: !!c.published,
  sold: !!c.sold,
  pending: !!c.pending,
  featured: !!c.featured,
  cover_url: c.photos && c.photos[0] ? c.photos[0].url : "",
  photos: c.photos || [],
  stage: c.stage || "intake",
  safety_inspected: !!c.safetyInspected,
  safety_inspected_date: c.safetyInspectedDate || null,
  warranty_type: c.warrantyType || "as_is",
  warranty_systems: c.warrantySystems || "",
  warranty_duration: c.warrantyDuration || "",
  warranty_pct_labor: Number(c.warrantyPctLabor) || 0,
  warranty_pct_parts: Number(c.warrantyPctParts) || 0,
});

/* ---------- cars ---------- */
export async function fetchPublicCars() {
  const { data, error } = await supabase
    .from("cars")
    .select("*")
    .eq("published", true)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(fromRow);
}

export async function fetchAllCars() {
  const { data, error } = await supabase
    .from("cars")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(fromRow);
}

export async function insertCar(car) {
  const { data, error } = await supabase.from("cars").insert(toRow(car)).select().single();
  if (error) throw error;
  return fromRow(data);
}

export async function updateCar(id, patch) {
  const row = {};
   const map = {
    year: "year",
    make: "make",
    model: "model",
    trim: "trim",
    price: "price",
    mileage: "mileage",
    condition: "condition",
    description: "description",
    vin: "vin",
    published: "published",
    sold: "sold",
    pending: "pending",
    featured: "featured",
    stage: "stage",
    safetyInspected: "safety_inspected",
    safetyInspectedDate: "safety_inspected_date",
    warrantyType: "warranty_type",
    warrantySystems: "warranty_systems",
    warrantyDuration: "warranty_duration",
    warrantyPctLabor: "warranty_pct_labor",
    warrantyPctParts: "warranty_pct_parts",
  };
  for (const k of Object.keys(patch)) if (map[k]) row[map[k]] = patch[k];
  if (patch.photos) {
    row.photos = patch.photos;
    row.cover_url = patch.photos[0] ? patch.photos[0].url : "";
  }
  const { data, error } = await supabase.from("cars").update(row).eq("id", id).select().single();
  if (error) throw error;
  return fromRow(data);
}

export async function deleteCar(car) {
  if (car.photos && car.photos.length) await removePhotos(car.photos);
  const { error } = await supabase.from("cars").delete().eq("id", car.id);
  if (error) throw error;
}

/* ---------- photos ---------- */
export async function uploadPhoto(blob) {
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

export async function removePhotos(photos) {
  const paths = photos.map((p) => p.path).filter(Boolean);
  if (!paths.length) return;
  await supabase.storage.from(BUCKET).remove(paths);
}

/* ---------- leads ---------- */
export async function createLead(lead) {
  const { error } = await supabase.from("leads").insert({
    name: lead.name,
    phone: lead.phone,
    note: lead.note || "",
    car_id: lead.carId,
    car_label: lead.carLabel,
    price: lead.price,
  });
  if (error) throw error;
}

export async function fetchLeads() {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map((l) => ({
    id: l.id,
    name: l.name,
    phone: l.phone,
    note: l.note || "",
    carLabel: l.car_label || "",
    price: Number(l.price) || 0,
    handled: !!l.handled,
    at: new Date(l.created_at).getTime(),
  }));
}

export async function updateLead(id, patch) {
  const { error } = await supabase.from("leads").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteLead(id) {
  const { error } = await supabase.from("leads").delete().eq("id", id);
  if (error) throw error;
}

/* ---------- what a car cost you (private) ---------- */
export async function fetchCarCost(carId) {
  const { data, error } = await supabase.from("car_costs").select("*").eq("car_id", carId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertCarCost(carId, { cost, expenses }) {
  const { error } = await supabase
    .from("car_costs")
    .upsert({ car_id: carId, cost: Number(cost) || 0, expenses: expenses || [], updated_at: new Date().toISOString() });
  if (error) throw error;
}

/* ---------- buyer's orders / sales records (private) ---------- */
export async function fetchSales() {
  const { data, error } = await supabase.from("sales").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createSale(row) {
  const { data, error } = await supabase.from("sales").insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function updateSale(id, patch) {
  const { data, error } = await supabase.from("sales").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteSale(id) {
  const { error } = await supabase.from("sales").delete().eq("id", id);
  if (error) throw error;
}

/* ---------- dealer sign in ---------- */
export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signOut() {
  await supabase.auth.signOut();
}
export async function currentSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
