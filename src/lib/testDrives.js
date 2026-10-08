import { supabase } from "./db.js";

// meta: { carId, vin, vehicle, driverName, driverLicense, driverLicenseState,
//         driverPhone, buyerName, dealerTag, salesperson, notes }
export async function logTestDrive(meta) {
  const { data, error } = await supabase
    .from("test_drives")
    .insert({
      car_id: meta.carId || null,
      vin: meta.vin || "",
      vehicle: meta.vehicle || "",
      driver_name: (meta.driverName || "").trim(),
      driver_license: meta.driverLicense || "",
      driver_license_state: meta.driverLicenseState || "VA",
      driver_phone: meta.driverPhone || "",
      buyer_name: meta.buyerName || "",
      dealer_tag: meta.dealerTag || "",
      salesperson: meta.salesperson || "",
      notes: meta.notes || "",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchTestDrives(carId) {
  const { data, error } = await supabase
    .from("test_drives")
    .select("*")
    .eq("car_id", carId)
    .order("out_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function markReturned(id) {
  const { data, error } = await supabase
    .from("test_drives")
    .update({ in_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
