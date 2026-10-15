import { supabase } from "./db.js";

// Deliberately separate from cars.js/sales.js — nothing here reads from or
// writes to the cars/sales/documents tables, and nothing in the dealership
// side of the app reads this table.

export const BLANK_RELEASE = {
  company_name: "",
  release_date: new Date().toISOString().slice(0, 10),
  vehicle_year: "",
  vehicle_make: "",
  vehicle_model: "",
  vehicle_color: "",
  vehicle_vin: "",
  vehicle_plate: "",
  plate_state: "VA",
  odometer: "",
  towed_from: "",
  tow_date: "",
  reason: "",
  releasee_name: "",
  releasee_address: "",
  releasee_phone: "",
  releasee_dl: "",
  storage_rate: "",
  storage_days: "",
  tow_fee: "",
  other_fee: "",
  amount_paid: "",
  notes: "",
  released_by: "",
};

export function releaseTotals(r) {
  const num = (v) => Number(v) || 0;
  const storageTotal = num(r.storage_rate) * num(r.storage_days);
  const totalDue = storageTotal + num(r.tow_fee) + num(r.other_fee);
  const balance = totalDue - num(r.amount_paid);
  return { storageTotal, totalDue, balance };
}

export async function saveReleaseForm(id, payload) {
  const row = { ...payload, updated_at: new Date().toISOString() };
  if (id) {
    const { data, error } = await supabase.from("release_forms").update(row).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from("release_forms").insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function fetchReleaseForms(q) {
  let query = supabase.from("release_forms").select("*").order("created_at", { ascending: false }).limit(50);
  if (q) {
    const s = q.replace(/[%,]/g, "");
    query = query.or(
      `vehicle_vin.ilike.%${s}%,vehicle_plate.ilike.%${s}%,releasee_name.ilike.%${s}%,company_name.ilike.%${s}%`
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function deleteReleaseForm(id) {
  const { error } = await supabase.from("release_forms").delete().eq("id", id);
  if (error) throw error;
}
