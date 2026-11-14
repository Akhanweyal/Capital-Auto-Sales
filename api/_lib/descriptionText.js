// Some Gemini models write out their reasoning ("*No markdown? Yes.*…") as
// the answer instead of the finished text. These pull the description out of
// a structured answer and reject anything that still reads like scratch-work.

const clip = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// The facts the description is written from. The dealership comes along as
// the seller — name and full street address — so the description can invite
// shoppers to it, rather than saying the car suits "drivers in the area".
export function buildFacts({ year, make, model, trim, mileage, condition, dealer, city }) {
  const d = dealer || {};
  const name = clip(d.name, 60);
  const place = [clip(d.address, 80), clip(d.city, 60)].filter(Boolean).join(", ");
  const seller = name || place ? `sold by ${name}${name && place ? " at " : ""}${place}` : null;
  return [
    `${clip(year, 4)} ${clip(make, 40)} ${clip(model, 40)}${trim ? " " + clip(trim, 40) : ""}`,
    mileage ? `${Number(mileage).toLocaleString("en-US")} miles` : null,
    condition ? `condition: ${clip(condition, 20)}` : null,
    seller || (city ? `located in ${clip(city, 60)}` : null),
  ]
    .filter(Boolean)
    .join(", ");
}

export function extractDescription(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.description === "string") return obj.description.trim();
  } catch {
    // Not JSON — judge the plain text.
  }
  return raw;
}

export function looksLikeDescription(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (t.length < 40 || t.length > 900) return false;
  if (/(^|\n)\s*[*\-•#>]|\n\s*\d+[.)]\s/.test(t)) return false;
  if (/markdown|constraint|no quotes|no emoji|checklist|word count|let me |draft\b/i.test(t)) return false;
  return true;
}
