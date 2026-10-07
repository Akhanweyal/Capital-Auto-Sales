// Given an auction lot page URL, pull out candidate photo URLs so the admin
// can pick which ones to add to the car listing. Most auction sites (Copart,
// IAA, Manheim, ADESA, ...) require a login and render their photo galleries
// via JavaScript, so a plain server-side fetch often can't see those photos
// at all — this only finds what's present in the page's raw HTML (meta tags
// meant for link previews, and any <img> tags that are server-rendered).
// When a site blocks that too, the admin falls back to downloading photos
// manually and using the regular upload button.

import { assertSafeUrl, requireUser, fetchWithLimits } from "./_lib/auctionShared.js";

const SKIP_WORDS = /logo|sprite|icon|favicon|pixel|spacer|avatar|placeholder|blank\.gif/i;
const IMG_EXT = /\.(jpe?g|png|webp)(\?|$)/i;
const MAX_IMAGES = 60;

function extractImages(html, baseUrl) {
  const abs = (raw) => {
    try {
      return new URL(String(raw).trim(), baseUrl).href;
    } catch {
      return null;
    }
  };

  const meta = new Set();
  for (const re of [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*>/gi,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]*>/gi,
  ]) {
    for (const m of html.matchAll(re)) {
      const c = m[0].match(/content=["']([^"']+)["']/i);
      const u = c && abs(c[1]);
      if (u) meta.add(u);
    }
  }

  const fromImgs = new Set();
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src =
      tag.match(/\bsrc=["']([^"']+)["']/i) ||
      tag.match(/\bdata-src=["']([^"']+)["']/i) ||
      tag.match(/\bdata-lazy(?:-src)?=["']([^"']+)["']/i);
    const u = src && abs(src[1]);
    if (u && IMG_EXT.test(u) && !SKIP_WORDS.test(u)) fromImgs.add(u);
  }

  return [...new Set([...meta, ...fromImgs])].slice(0, MAX_IMAGES);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
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
    target = assertSafeUrl(req.query.url);
  } catch (e) {
    res.status(400).json({ error: e.message });
    return;
  }

  try {
    const r = await fetchWithLimits(target.href);
    if (!r.ok) {
      res.status(200).json({
        images: [],
        error: `That page returned ${r.status} — it may need you to be logged in to view it.`,
      });
      return;
    }
    const html = await r.text();
    const images = extractImages(html, target.href);
    res.status(200).json({
      images,
      error: images.length ? undefined : "Couldn't find any photos in that page's HTML.",
    });
  } catch (e) {
    res.status(200).json({
      images: [],
      error: "Couldn't load that page. It may block automated access, or need you to be logged in.",
    });
  }
}
