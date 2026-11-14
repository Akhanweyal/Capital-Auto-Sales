// Some Gemini models write out their reasoning ("*No markdown? Yes.*…") as
// the answer instead of the finished text. These pull the description out of
// a structured answer and reject anything that still reads like scratch-work.

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
