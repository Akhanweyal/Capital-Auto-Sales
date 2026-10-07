/* ---------- VIN barcode / decode helpers ---------- */

// Valid VINs are 17 chars, no I / O / Q (easily confused with 1 / 0).
export function isValidVinFormat(vin) {
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin || "");
}

const VIN_TRANSLIT = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

// Every VIN sold in North America since 1981 carries a check digit (position 9,
// ISO 3779 / NHTSA) computed from the other 16 — scanning an unrelated barcode
// (a parts label, a QR code, etc.) that happens to be 17 alnum chars will
// almost never satisfy it, so it's a reliable way to reject mis-scans.
export function isValidVin(vin) {
  const s = (vin || "").toUpperCase();
  if (!isValidVinFormat(s)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = s[i];
    const val = /[0-9]/.test(ch) ? Number(ch) : VIN_TRANSLIT[ch];
    sum += val * VIN_WEIGHTS[i];
  }
  const rem = sum % 11;
  const expected = rem === 10 ? "X" : String(rem);
  return s[8] === expected;
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
