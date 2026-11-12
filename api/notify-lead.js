// Pushes a phone notification to the dealer's cell whenever a new lead row
// is inserted into `leads`, via ntfy.sh (the same push service already used
// for the towing business). Supabase calls this from a database trigger on
// INSERT to public.leads — it's never called from the browser, so the usual
// requireUser() Bearer-token check doesn't apply here. Instead it's
// protected by a shared secret the trigger sends as a custom header, since
// the URL itself is otherwise publicly reachable.
//
// Required env vars (set in Vercel):
//   NTFY_TOPIC      — the ntfy.sh topic to publish to (treat like a password:
//                      anyone who knows it can read or spoof notifications)
//   WEBHOOK_SECRET  — shared secret; must match the header value the
//                      database trigger sends

import { timingSafeEqual } from "node:crypto";

const NTFY_SERVER = "https://ntfy.sh";

function secretMatches(given, expected) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(expected || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

// The form is public, so cap what a stranger can push to the phone.
const clip = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || !secretMatches(req.headers["x-webhook-secret"], secret)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const topic = process.env.NTFY_TOPIC;
  if (!topic) {
    res.status(200).json({ error: "NTFY_TOPIC not configured" });
    return;
  }

  const record = (req.body && req.body.record) || {};
  const name = clip(record.name, 80);
  const phone = clip(record.phone, 30);
  const note = clip(record.note, 300);
  const carLabel = clip(record.car_label, 80);

  const lines = [name && `From: ${name}`, phone && `Phone: ${phone}`, note && `Note: ${note}`].filter(Boolean);
  const message = lines.length ? lines.join("\n") : "New lead submitted — check the admin panel.";
  const priceStr = Number(record.price)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
        Number(record.price)
      )
    : "";
  const title = carLabel ? `New inquiry: ${carLabel}${priceStr ? ` (${priceStr})` : ""}` : "New car inquiry";

  const digits = phone.replace(/[^0-9+]/g, "");

  try {
    // ntfy's JSON publish, not the header form: HTTP headers can't carry
    // accents or other non-Latin characters, and a customer's name can.
    const r = await fetch(NTFY_SERVER, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        title,
        message,
        priority: 4,
        tags: ["car"],
        ...(digits.length >= 7 ? { click: `tel:${digits}` } : {}),
      }),
    });
    if (!r.ok) throw new Error(`ntfy responded ${r.status}`);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("notify-lead: failed to reach ntfy —", e && e.message);
    // Still 200 — a retry storm over a transient ntfy outage isn't worth it
    // for a best-effort notification; the lead itself is already saved.
    res.status(200).json({ error: "Failed to send notification" });
  }
}
