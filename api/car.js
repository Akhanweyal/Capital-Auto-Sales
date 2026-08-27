// Serves the SPA shell for /car/:id, but with the <title>/description/OG/Twitter
// tags swapped for that specific car's info. This exists so that pasting a car
// link into iMessage/Facebook/Slack/etc. shows the actual car (photo, price,
// title) instead of the generic homepage preview — those crawlers don't run
// the client-side React app, they only read the HTML we hand back here.
// Real browsers get the exact same shell (same script tags), so the app boots
// and takes over routing normally once it loads.

const money = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Number(n) || 0
  );
const miles = (n) => new Intl.NumberFormat("en-US").format(Number(n) || 0);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function fetchCar(id) {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key || !id) return null;

  const api =
    `${url}/rest/v1/cars?id=eq.${encodeURIComponent(id)}&published=eq.true` +
    `&select=year,make,model,trim,price,mileage,description,cover_url,sold,vin&limit=1`;

  const r = await fetch(api, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}

function withCarMeta(html, car, pageUrl) {
  const title = `${car.year} ${car.make} ${car.model}${car.trim ? " " + car.trim : ""}`.trim();
  const fullTitle = `${title} — ${money(car.price)} | Capital Auto Sales`;
  const desc =
    (car.description && car.description.trim()) ||
    `${miles(car.mileage)} miles, ${car.year} ${car.make} ${car.model}. Call or text 804-372-4422 for details.`;

  let out = html
    .replace(/<title>.*?<\/title>/, `<title>${esc(fullTitle)}</title>`)
    .replace(/<meta[^>]*name="description"[^>]*\/>/, `<meta name="description" content="${esc(desc)}" />`)
    .replace(/<meta property="og:type"[^>]*\/>/, `<meta property="og:type" content="product" />`)
    .replace(/<meta property="og:title"[^>]*\/>/, `<meta property="og:title" content="${esc(fullTitle)}" />`)
    .replace(/<meta[^>]*property="og:description"[^>]*\/>/, `<meta property="og:description" content="${esc(desc)}" />`)
    .replace(/<meta name="twitter:title"[^>]*\/>/, `<meta name="twitter:title" content="${esc(fullTitle)}" />`)
    .replace(
      /<meta[^>]*name="twitter:description"[^>]*\/>/,
      `<meta name="twitter:description" content="${esc(desc)}" />`
    );

  if (pageUrl) {
    out = out.replace(
      "</head>",
      `    <meta property="og:url" content="${esc(pageUrl)}" />\n    <link rel="canonical" href="${esc(pageUrl)}" />\n  </head>`
    );
  }

  if (car.cover_url) {
    out = out
      .replace(
        /<meta name="twitter:card" content="summary" \/>/,
        `<meta name="twitter:card" content="summary_large_image" />`
      )
      .replace(
        '</head>',
        `    <meta property="og:image" content="${esc(car.cover_url)}" />\n` +
          `    <meta name="twitter:image" content="${esc(car.cover_url)}" />\n  </head>`
      );
  }

  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: title,
    description: desc,
    brand: { "@type": "Brand", name: car.make },
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: Number(car.price) || 0,
      availability: car.sold ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      url: pageUrl || undefined,
    },
  };
  if (car.cover_url) productLd.image = car.cover_url;
  if (car.vin) productLd.sku = car.vin;

  const ldJson = JSON.stringify(productLd).replace(/</g, "\\u003c");
  out = out.replace("</head>", `    <script type="application/ld+json">${ldJson}</script>\n  </head>`);

  return out;
}

export { withCarMeta, fetchCar };

export default async function handler(req, res) {
  const { id } = req.query;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";

  try {
    const shellRes = await fetch(`${protocol}://${host}/index.html`);
    let html = await shellRes.text();

    const car = await fetchCar(id).catch(() => null);
    if (car) html = withCarMeta(html, car, `${protocol}://${host}/car/${id}`);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
    res.status(200).send(html);
  } catch (e) {
    res.writeHead(302, { Location: "/" });
    res.end();
  }
}
