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
//
// It is NOT proof a misread photo is right: roughly 1 in 11 random misreads
// still passes. Anything read by OCR must also decode cleanly (see
// decodeVin's `clean`) before it is trusted.
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

// A VIN never contains I, O or Q, so one of those in a read is always a
// misread 1 or 0.
const normalizeVinChars = (s) => s.replace(/[OQ]/g, "0").replace(/I/g, "1");

// Every checksum-valid VIN in the text, best first. A title or registration
// barcode (often PDF417) encodes several fields as one string, and OCR runs
// words together, so this looks inside long runs of letters/digits too, and
// at VINs printed in groups after a "VIN" label ("1FM5K 8DH4H GB254 21").
export function vinCandidates(text) {
  const s = (text || "").toUpperCase();
  const found = [];
  const add = (v) => {
    if (v && !found.includes(v)) found.push(v);
  };

  for (const run of s.match(/[A-Z0-9]{17,}/g) || []) {
    const n = normalizeVinChars(run);
    for (let i = 0; i + 17 <= n.length; i++) {
      const w = n.slice(i, i + 17);
      if (isValidVin(w)) add(w);
    }
  }

  for (const m of s.matchAll(/V\.?\s?[I1]\.?\s?N\.?[^A-Z0-9]{0,3}(?:NO\.?|NUMBER|#)?[^A-Z0-9]{0,3}([A-Z0-9][A-Z0-9 \-]{16,32})/g)) {
    const joined = normalizeVinChars(m[1].replace(/[^A-Z0-9]/g, ""));
    for (let i = 0; i + 17 <= joined.length; i++) {
      const w = joined.slice(i, i + 17);
      if (isValidVin(w)) add(w);
    }
  }
  return found;
}

export function extractVin(text) {
  return vinCandidates(text)[0] || null;
}

// Free, no-key NHTSA decoder — the same government VIN database dealer
// software (ComSoft, DealerCenter, etc.) decodes against.
//
// `clean` is the one to trust for a VIN that was read off a photo: NHTSA
// reports ErrorCode "0" only when the VIN decodes completely with a correct
// check digit. A misread that happens to pass the check digit comes back
// with no model and an error (one decoded as a "POLAR TANK TRAILER").
export async function decodeVin(vin) {
  const res = await fetch(
    `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(vin)}?format=json`
  );
  if (!res.ok) throw new Error("VIN decode request failed");
  const data = await res.json();
  const row = data.Results && data.Results[0];
  if (!row || !row.Make) throw new Error("No data found for that VIN");
  const codes = String(row.ErrorCode || "").split(",").map((c) => c.trim()).filter(Boolean);
  return {
    year: row.ModelYear || "",
    make: row.Make || "",
    model: row.Model || "",
    trim: row.Trim || row.Series || "",
    bodyClass: row.BodyClass || "",
    clean: codes.length > 0 && codes.every((c) => c === "0") && !!row.Model && !!row.ModelYear,
  };
}
