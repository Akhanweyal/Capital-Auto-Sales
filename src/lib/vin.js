/* ---------- VIN barcode / decode helpers ---------- */

// Valid VINs are 17 chars, no I / O / Q (easily confused with 1 / 0).
export function isValidVinFormat(vin) {
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin || "");
}

// Free, no-key NHTSA decoder — the same government VIN database dealer
// software (ComSoft, DealerCenter, etc.) decodes against.
export async function decodeVin(vin) {
  const res = await fetch(
    `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(vin)}?format=json`
  );
  if (!res.ok) throw new Error("VIN decode request failed");
  const data = await res.json();
  const row = data.Results && data.Results[0];
  if (!row || !row.Make) throw new Error("No data found for that VIN");
  return {
    year: row.ModelYear || "",
    make: row.Make || "",
    model: row.Model || "",
    trim: row.Trim || row.Series || "",
    bodyClass: row.BodyClass || "",
  };
}
