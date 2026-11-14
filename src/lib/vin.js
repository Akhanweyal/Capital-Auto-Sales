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

// A title or registration barcode (often PDF417) typically encodes several
// fields as one string — title number, VIN, owner/state data — not just the
// bare VIN, so an exact match against the whole string misses it. Try the
// whole string first, then fall back to scanning it for any 17-char,
// VIN-charset window that passes the checksum.
// A VIN never contains I, O or Q, so when OCR reports one it misread 1 or 0.
const normalizeVinChars = (s) => s.replace(/[OQ]/g, "0").replace(/I/g, "1");

function firstValidWindow(run) {
  const s = normalizeVinChars(run);
  for (let i = 0; i + 17 <= s.length; i++) {
    const w = s.slice(i, i + 17);
    if (isValidVin(w)) return w;
  }
  return null;
}

// Look-alike pairs OCR swaps on printed documents.
const OCR_SWAPS = { S: "5", 5: "S", B: "8", 8: "B", Z: "2", 2: "Z", G: "6", 6: "G", D: "0", 0: "D" };

// Repairs a single misread character, accepted only when exactly one
// repair satisfies the check digit — two would mean it's a guess.
function repairOneChar(run) {
  const s = normalizeVinChars(run);
  const found = new Set();
  for (let i = 0; i < 17; i++) {
    const alt = OCR_SWAPS[s[i]];
    if (!alt) continue;
    const fixed = s.slice(0, i) + alt + s.slice(i + 1);
    if (isValidVin(fixed)) found.add(fixed);
  }
  return found.size === 1 ? [...found][0] : null;
}

export function extractVin(text) {
  const s = (text || "").toUpperCase();
  if (isValidVin(s)) return s;

  const runs = s.match(/[A-Z0-9]{17,}/g) || [];
  for (const run of runs) {
    const hit = firstValidWindow(run);
    if (hit) return hit;
  }

  // Printed or OCR'd in groups ("1FM5K 8D83H GA123 45") after a VIN label.
  const labelled = [];
  for (const m of s.matchAll(/V\.?\s?[I1]\.?\s?N\.?[^A-Z0-9]{0,3}(?:NO\.?|NUMBER|#)?[^A-Z0-9]{0,3}([A-Z0-9][A-Z0-9 \-]{16,32})/g)) {
    const joined = m[1].replace(/[^A-Z0-9]/g, "");
    labelled.push(joined);
    const hit = firstValidWindow(joined);
    if (hit) return hit;
  }

  for (const run of [...runs.filter((r) => r.length === 17), ...labelled.map((l) => l.slice(0, 17))]) {
    if (run.length === 17 && /[A-Z]/.test(run) && /[0-9]/.test(run)) {
      const hit = repairOneChar(run);
      if (hit) return hit;
    }
  }
  return null;
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
