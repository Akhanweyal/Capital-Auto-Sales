// Pushes a phone notification to the dealer's cell whenever a new lead row
// is inserted into `leads`, via ntfy.sh (the same push service already used
// for the towing business). Supabase calls this directly through a
// Database Webhook (Database -> Webhooks in the Supabase dashboard, firing
// on INSERT to public.leads) — it's never called from the browser, so the
// usual requireUser() Bearer-token check doesn't apply here. Instead it's
// protected by a shared secret the webhook sends as a custom header, since
// the URL itself is otherwise publicly reachable.
//
// Required env vars (set in Vercel):
//   NTFY_TOPIC      — the ntfy.sh topic to publish to (treat like a password:
//                      anyone who knows it can read or spoof notifications)
//   WEBHOOK_SECRET  — shared secret; must match the header value configured
//                      on the Supabase webhook

const NTFY_SERVER = "https://ntfy.sh";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || req.headers["x-webhook-secret"] !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const topic = process.env.NTFY_TOPIC;
  if (!topic) {
    res.status(200).json({ error: "NTFY_TOPIC not configured" });
    return;
  }

  const record = (req.body && req.body.record) || {};
  const { name, phone, note, car_label, price } = record;

  const lines = [name ? `From: ${name}` : null, phone ? `Phone: ${phone}` : null, note ? `Note: ${note}` : null].filter(
    Boolean
  );
  const message = lines.length ? lines.join("\n") : "New lead submitted — check the admin panel.";
  const priceStr = price
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(price)
    : null;
  const title = car_label ? `New inquiry: ${car_label}${priceStr ? ` (${priceStr})` : ""}` : "New car inquiry";

  try {
    await fetch(`${NTFY_SERVER}/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: {
        Title: title,
        Priority: "high",
        Tags: "car",
      },
      body: message,
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("notify-lead: failed to reach ntfy —", e && e.message);
    // Still 200 — Supabase retries failed webhooks, and a retry storm over a
    // transient ntfy outage isn't worth it for a best-effort notification.
    res.status(200).json({ error: "Failed to send notification" });
  }
}
