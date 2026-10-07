// Shared by the two "pull photos from an auction listing" endpoints — kept in
// one place so the auth check and SSRF guard can't drift apart between them.
// File/folder names starting with "_" are excluded from Vercel's API routing,
// so this never becomes its own endpoint.

// Best-effort block on loopback/private/link-local hosts. This only looks at
// the hostname as written (no DNS resolution), so it's a mitigation against
// casual misuse, not a guarantee against DNS-rebinding — acceptable here
// since this is only reachable by signed-in dealer admins, not the public.
const PRIVATE_HOST_RE =
  /^(127\.|10\.|192\.168\.|169\.254\.|0\.|localhost$|\[?::1\]?$)|^172\.(1[6-9]|2\d|3[01])\./i;

export function assertSafeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http/https links are supported.");
  }
  if (PRIVATE_HOST_RE.test(u.hostname)) {
    throw new Error("That URL isn't allowed.");
  }
  return u;
}

export async function requireUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!token || !url || !key) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const user = await r.json();
    return user && user.id ? { user, token } : null;
  } catch {
    return null;
  }
}

export async function fetchWithLimits(url, { timeoutMs = 8000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CapitalAutoSalesBot/1.0)",
        ...headers,
      },
    });
  } finally {
    clearTimeout(t);
  }
}
