// Generates /sitemap.xml on demand from the live published inventory, so
// Google finds every current car listing (and drops sold-out/unpublished
// ones automatically) without anyone maintaining the file by hand.

export default async function handler(req, res) {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const origin = `${protocol}://${host}`;

  let cars = [];
  if (url && key) {
    try {
      const r = await fetch(
        `${url}/rest/v1/cars?select=id,created_at&published=eq.true&order=created_at.desc`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (r.ok) cars = await r.json();
    } catch (e) {
      cars = [];
    }
  }

  const esc = (s) => String(s).replace(/&/g, "&amp;");
  const today = new Date().toISOString().slice(0, 10);

  const urls = [
    `<url><loc>${esc(origin)}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...cars.map((c) => {
      const lastmod = (c.created_at ? new Date(c.created_at) : new Date()).toISOString().slice(0, 10);
      return `<url><loc>${esc(origin)}/car/${esc(c.id)}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`;
    }),
  ].join("\n  ");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  ${urls}\n</urlset>\n`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).send(xml);
}
