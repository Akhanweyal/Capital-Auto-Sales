// Downloads one photo the admin picked (from api/auction-photos.js's results)
// and uploads it into the car-photos bucket, same as a regular photo upload.
// Runs server-side so it isn't subject to the browser's CORS restrictions on
// fetching bytes from a third-party host. Uses the signed-in admin's own
// access token for the storage write, so it's bound by the same storage
// policies a normal upload from the browser would be — no elevated key here.

import { createClient } from "@supabase/supabase-js";
import { assertSafeUrl, requireUser, fetchWithLimits } from "./_lib/auctionShared.js";

const BUCKET = "car-photos";
const MAX_BYTES = 12_000_000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const auth = await requireUser(req);
  if (!auth) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }

  let target;
  try {
    target = assertSafeUrl(req.body && req.body.url);
  } catch (e) {
    res.status(400).json({ error: e.message });
    return;
  }

  try {
    const r = await fetchWithLimits(target.href, { timeoutMs: 15000 });
    if (!r.ok) throw new Error(`Image fetch failed (${r.status})`);
    const type = (r.headers.get("content-type") || "").split(";")[0].trim();
    if (!type.startsWith("image/")) throw new Error("That link isn't an image.");

    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error("That image is too large.");

    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${auth.token}` } },
    });
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: type, cacheControl: "31536000" });
    if (error) throw error;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    res.status(200).json({ url: data.publicUrl, path });
  } catch (e) {
    res.status(200).json({ error: e.message || "Couldn't import that photo." });
  }
}
