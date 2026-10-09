import { supabase } from "./db.js";

export const OPERATOR_TYPES = [
  {
    value: "prospective_purchaser",
    label: "Customer is driving (prospective purchaser)",
    needsForm: true,
    maxHours: 5 * 24,
  },
  {
    value: "dealer_authorized_individual",
    label: "Dealer-authorized individual moving the vehicle (no salesperson, no customer)",
    needsForm: true,
    maxHours: 24,
  },
  {
    value: "salesperson_driving",
    label: "Salesperson is driving (customer riding along)",
    needsForm: false,
    maxHours: null,
  },
];

// meta: { carId, vin, vehicle, operatorType, driverName, driverAddress,
//         driverCity, driverState, driverZip, driverPhone, driverEmail,
//         driverLicense, driverLicenseState, buyerName, dealerTag,
//         salesperson, notes }
export async function logTestDrive(meta) {
  const type = OPERATOR_TYPES.find((t) => t.value === meta.operatorType) || OPERATOR_TYPES[0];
  const expiresAt = type.maxHours ? new Date(Date.now() + type.maxHours * 3600 * 1000).toISOString() : null;

  const { data, error } = await supabase
    .from("test_drives")
    .insert({
      car_id: meta.carId || null,
      vin: meta.vin || "",
      vehicle: meta.vehicle || "",
      operator_type: type.value,
      driver_name: (meta.driverName || "").trim(),
      driver_address: meta.driverAddress || "",
      driver_city: meta.driverCity || "",
      driver_state: meta.driverState || "VA",
      driver_zip: meta.driverZip || "",
      driver_phone: meta.driverPhone || "",
      driver_email: meta.driverEmail || "",
      driver_license: meta.driverLicense || "",
      driver_license_state: meta.driverLicenseState || "VA",
      buyer_name: meta.buyerName || "",
      dealer_tag: meta.dealerTag || "",
      salesperson: meta.salesperson || "",
      notes: meta.notes || "",
      expires_at: expiresAt,
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
