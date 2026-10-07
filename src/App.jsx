import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  configured,
  supabase,
  fetchPublicCars,
  fetchAllCars,
  insertCar,
  updateCar,
  deleteCar,
  uploadPhoto,
  removePhotos,
  createLead,
  fetchLeads,
  updateLead,
  deleteLead,
  fetchCarCost,
  upsertCarCost,
  fetchSales,
  createSale,
  updateSale,
  deleteSale,
  signIn,
  signOut,
} from "./lib/db.js";
import { BLANK_SALE, calcVaTax, saleTotals, salesToCsv } from "./lib/sales.js";
import { decodeVin, isValidVinFormat, isValidVin } from "./lib/vin.js";

/* ============================================================
   YOUR BUSINESS DETAILS — edit this block and nothing else
   ============================================================ */
export const DEALER = {
  name: "Capital Auto Sales",
  phone: "804-372-4422",
  phoneHref: "+18043724422",
  address: "8607 Oakview Ave",
  city: "Henrico, VA 23228",
  hours: "Mon–Sat 9am – 7pm  ·  Sun by appointment",
};

/* ---------- helpers ---------- */
const money = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Number(n) || 0
  );
const moneyCents = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);
const miles = (n) => new Intl.NumberFormat("en-US").format(Number(n) || 0);
const title = (c) => `${c.year} ${c.make} ${c.model}${c.trim ? " " + c.trim : ""}`.trim();

function setPath(obj, path, value) {
  const [head, ...rest] = path.split(".");
  if (!rest.length) return { ...obj, [head]: value };
  return { ...obj, [head]: setPath(obj[head] || {}, rest.join("."), value) };
}

function loadImage(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = r.result;
    };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
async function shrink(file, maxDim = 1600, quality = 0.78) {
  const img = await loadImage(file);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, "image/jpeg", quality));
}

/* ---------- routing (no library needed) ---------- */
function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((to) => {
    window.history.pushState({}, "", to);
    setPath(to);
    window.scrollTo({ top: 0 });
  }, []);
  return [path, go];
}

/* ---------- brand marks ---------- */
function Badge({ size = 44 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" style={{ display: "block" }}>
      <circle cx="50" cy="50" r="48" fill="var(--gold)" />
      <circle cx="50" cy="50" r="44.5" fill="var(--navy-700)" />
      <circle cx="50" cy="50" r="41" fill="none" stroke="var(--gold)" strokeWidth="0.7" opacity="0.85" />
      <g fill="var(--gold)">
        <path d="M39 46h4.5l3.5-7.5h13L64 46h4.5a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H39a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3z" />
        <rect x="27" y="45" width="7" height="1.6" rx="0.8" />
        <rect x="25" y="50" width="9" height="1.6" rx="0.8" />
        <rect x="28" y="55" width="7" height="1.6" rx="0.8" />
      </g>
      <circle cx="45" cy="57" r="4.6" fill="var(--gold)" />
      <circle cx="45" cy="57" r="1.6" fill="var(--navy-700)" />
      <circle cx="63" cy="57" r="4.6" fill="var(--gold)" />
      <circle cx="63" cy="57" r="1.6" fill="var(--navy-700)" />
      <rect x="30" y="68" width="40" height="0.9" fill="var(--gold)" opacity="0.8" />
      <text x="50" y="79" textAnchor="middle" fill="#fff" style={{ font: "700 12px var(--display)", letterSpacing: "0.5px" }}>
        CAS
      </text>
    </svg>
  );
}

function CarGhost() {
  return (
    <div className="ghost">
      <svg viewBox="0 0 120 60" width="96" aria-hidden="true">
        <g fill="var(--gold)" opacity="0.5">
          <path d="M28 34h6l5-11h20l5 11h6a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4v-6a4 4 0 0 1 4-4z" />
          <circle cx="38" cy="48" r="6" />
          <circle cx="72" cy="48" r="6" />
        </g>
      </svg>
      <span>Photo coming soon</span>
    </div>
  );
}

function Rule() {
  return (
    <div className="rule">
      <span className="rule-line" />
      <span className="rule-dot" />
      <span className="rule-line" />
    </div>
  );
}

/* ============================================================
   APP
   ============================================================ */
export default function App() {
  const [path, go] = useRoute();
  const [cars, setCars] = useState([]);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const say = useCallback((msg) => {
    setToast(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const isAdmin = path.startsWith("/admin");

  useEffect(() => {
    if (isAdmin || !configured) {
      setReady(true);
      return;
    }
    let live = true;
    fetchPublicCars()
      .then((list) => live && setCars(list))
      .catch(() => live && say("Couldn't load inventory. Refresh the page."))
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [isAdmin, say]);

  if (!configured) return <NotConfigured />;

  if (isAdmin) return <Admin go={go} say={say} />;

  const carId = path.startsWith("/car/") ? path.slice(5) : null;

  return (
    <div className="app">
      <SiteHeader go={go} />
      {carId ? (
        <CarPage car={cars.find((c) => c.id === carId)} ready={ready} go={go} />
      ) : (
        <Home cars={cars} ready={ready} open={(id) => go(`/car/${id}`)} />
      )}
      <SiteFooter go={go} />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="gate">
      <div className="gate-card">
        <Badge size={64} />
        <h2>Almost there</h2>
        <p>
          This site needs its database keys. Add <code>VITE_SUPABASE_URL</code> and{" "}
          <code>VITE_SUPABASE_ANON_KEY</code> in your hosting settings, then redeploy. Setup steps are in
          the README.
        </p>
      </div>
    </div>
  );
}

/* ---------- public chrome ---------- */
function SiteHeader({ go }) {
  return (
    <header className="topbar">
      <div className="wrap topbar-in">
        <button className="brand" onClick={() => go("/")}>
          <Badge size={46} />
          <span className="brand-txt">
            <strong>CAPITAL</strong>
            <em>AUTO SALES</em>
          </span>
        </button>
        <div className="topbar-right">
          <span className="topbar-addr">
            {DEALER.address} · {DEALER.city}
          </span>
          <a className="btn btn-gold" href={`tel:${DEALER.phoneHref}`}>
            Call {DEALER.phone}
          </a>
        </div>
      </div>
    </header>
  );
}

function SiteFooter({ go }) {
  const mapsUrl =
    "https://maps.google.com/?q=" + encodeURIComponent(DEALER.address + ", " + DEALER.city);

  return (
    <footer className="foot">
      <div className="wrap foot-in">
        <div>
          <Badge size={54} />
          <p className="foot-name">{DEALER.name}</p>
          <p className="micro gold">PRE-OWNED · FINANCE · TRADE-INS</p>
        </div>
        <div>
          <p className="micro">Visit</p>
          <p>{DEALER.address}</p>
          <p>{DEALER.city}</p>
          <p>
            <a className="linkish" href={mapsUrl} target="_blank" rel="noreferrer">
              Get directions →
            </a>
          </p>
          <p className="foot-hours">{DEALER.hours}</p>
        </div>
        <div>
          <p className="micro">Talk to us</p>
          <a className="foot-phone" href={`tel:${DEALER.phoneHref}`}>
            {DEALER.phone}
          </a>
          <p>
            <a href={`sms:${DEALER.phoneHref}`}>Text the same number</a>
          </p>
        </div>
      </div>
      <div className="wrap foot-btm">
        <span>
          © {new Date().getFullYear()} {DEALER.name}
        </span>
        <button className="linkish" onClick={() => go("/admin")}>
          Dealer sign in
        </button>
      </div>
    </footer>
  );
}

/* ---------- home ---------- */
const EMPTY_FILTERS = { q: "", make: "", year: "", min: "", max: "", sort: "new" };

function Home({ cars, ready, open }) {
  const [f, setF] = useState(EMPTY_FILTERS);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const makes = useMemo(() => Array.from(new Set(cars.map((c) => c.make).filter(Boolean))).sort(), [cars]);
  const years = useMemo(
    () => Array.from(new Set(cars.map((c) => c.year).filter(Boolean))).sort((a, b) => b - a),
    [cars]
  );

  const list = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    let out = cars.filter((c) => {
      if (q) {
        const hay = `${c.year} ${c.make} ${c.model} ${c.trim} ${c.description} ${c.vin}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (f.make && c.make !== f.make) return false;
      if (f.year && String(c.year) !== String(f.year)) return false;
      if (f.min && c.price < Number(f.min)) return false;
      if (f.max && c.price > Number(f.max)) return false;
      return true;
    });
    const by = {
      new: (a, b) => b.createdAt - a.createdAt,
      priceUp: (a, b) => a.price - b.price,
      priceDown: (a, b) => b.price - a.price,
      milesUp: (a, b) => a.mileage - b.mileage,
      yearDown: (a, b) => b.year - a.year,
    };
    out = out.slice().sort(by[f.sort] || by.new);
    return out.sort(
      (a, b) => Number(!!a.sold) - Number(!!b.sold) || (b.featured ? 1 : 0) - (a.featured ? 1 : 0)
    );
  }, [cars, f]);

  const dirty = JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <main>
      <section className="hero">
        <div className="wrap hero-in">
          <p className="micro gold spaced">· PRE-OWNED · FINANCE · TRADE-INS ·</p>
          <h1>
            Every car on the lot,
            <br />
            with the price up front.
          </h1>
          <p className="hero-sub">
            Browse what's here right now. See something you like — call or text {DEALER.phone} and we'll
            have the keys ready when you pull in.
          </p>
        </div>
        <div className="wrap">
          <div className="filterbar">
            <div className="fb-search">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input value={f.q} onChange={set("q")} placeholder="Search Honda, truck, 2018…" aria-label="Search inventory" />
            </div>
            <select value={f.make} onChange={set("make")} aria-label="Make">
              <option value="">Any make</option>
              {makes.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <select value={f.year} onChange={set("year")} aria-label="Year">
              <option value="">Any year</option>
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
            <div className="fb-price">
              <input value={f.min} onChange={set("min")} inputMode="numeric" placeholder="Min $" aria-label="Minimum price" />
              <span>–</span>
              <input value={f.max} onChange={set("max")} inputMode="numeric" placeholder="Max $" aria-label="Maximum price" />
            </div>
            <select value={f.sort} onChange={set("sort")} aria-label="Sort by">
              <option value="new">Newest first</option>
              <option value="priceUp">Price: low to high</option>
              <option value="priceDown">Price: high to low</option>
              <option value="milesUp">Lowest miles</option>
              <option value="yearDown">Newest year</option>
            </select>
          </div>
        </div>
      </section>

      <section className="wrap inv">
        <div className="inv-head">
          <h2>
            {list.length} {list.length === 1 ? "car" : "cars"} available
          </h2>
          {dirty && (
            <button className="linkish" onClick={() => setF(EMPTY_FILTERS)}>
              Clear filters
            </button>
          )}
        </div>

        {!ready ? (
          <div className="grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card skeleton" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="empty">
            <Badge size={64} />
            <h3>{cars.length ? "Nothing matches that search" : "Inventory is being updated"}</h3>
            <p>
              {cars.length
                ? "Try widening the price range or clearing the filters."
                : `New arrivals go up as soon as they're ready. Call ${DEALER.phone} and we'll tell you what's coming in this week.`}
            </p>
            {cars.length ? (
              <button className="btn btn-navy" onClick={() => setF(EMPTY_FILTERS)}>
                Clear filters
              </button>
            ) : (
              <a className="btn btn-navy" href={`tel:${DEALER.phoneHref}`}>
                Call {DEALER.phone}
              </a>
            )}
          </div>
        ) : (
          <div className="grid">
            {list.map((c) => (
              <CarCard key={c.id} car={c} onClick={() => open(c.id)} />
            ))}
          </div>
        )}
      </section>

      <section className="band">
        <div className="wrap band-in">
          <div>
            <p className="micro gold">Trade-ins welcome</p>
            <h3>Bring your car in and we'll price it while you look around.</h3>
          </div>
          <div className="band-cta">
            <a className="btn btn-gold" href={`tel:${DEALER.phoneHref}`}>
              Call {DEALER.phone}
            </a>
            <a className="btn btn-ghost" href={`sms:${DEALER.phoneHref}`}>
              Send a text
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

function CarCard({ car, onClick }) {
  return (
    <article className={"card" + (car.sold ? " is-sold" : "") + (car.featured ? " is-feat" : "")}>
      <a
        className="card-hit"
        href={`/car/${car.id}`}
        onClick={(e) => {
          e.preventDefault();
          onClick();
        }}
        aria-label={`View ${title(car)}`}
      >
        <div className="card-img">
          {car.cover ? <img src={car.cover} alt={title(car)} loading="lazy" /> : <CarGhost />}
                    {car.sold && <span className="tag tag-sold">Sold</span>}
          {!car.sold && car.pending && <span className="tag tag-pending">Sale pending</span>}
          {!car.sold && !car.pending && car.featured && <span className="tag tag-feat">Featured</span>}
        </div>
        <div className="card-body">
          <h3>{title(car)}</h3>
          <p className="price">{money(car.price)}</p>
          <div className="plate">
            <span>
              <em>Miles</em>
              {miles(car.mileage)}
            </span>
            <span>
              <em>Year</em>
              {car.year}
            </span>
            <span>
              <em>Condition</em>
              {car.condition}
            </span>
          </div>
        </div>
      </a>
    </article>
  );
}

/* ---------- car detail ---------- */
function CarPage({ car, ready, go }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (car) document.title = `${title(car)} — ${DEALER.name}`;
    return () => {
      document.title = `${DEALER.name} — Quality Pre-Owned Cars in Richmond, VA`;
    };
  }, [car]);

  if (!car && !ready)
    return (
      <main className="wrap empty">
        <div className="card skeleton" style={{ width: "100%", maxWidth: 480 }} />
      </main>
    );

  if (!car)
    return (
      <main className="wrap empty">
        <h3>That listing is no longer available</h3>
        <button className="btn btn-navy" onClick={() => go("/")}>
          Back to inventory
        </button>
      </main>
    );

  const shots = car.photos.length ? car.photos.map((p) => p.url) : car.cover ? [car.cover] : [];

  return (
    <main className="detail">
      <div className="wrap">
        <button className="linkish back" onClick={() => go("/")}>
          ← All inventory
        </button>
      </div>
      <div className="wrap detail-grid">
        <div>
          <div className="stage">
            {shots.length ? <img src={shots[Math.min(i, shots.length - 1)]} alt={title(car)} /> : <CarGhost />}
            {car.sold && <span className="tag tag-sold big">Sold</span>}
            {shots.length > 1 && (
              <>
                <button className="nav prev" onClick={() => setI((i - 1 + shots.length) % shots.length)} aria-label="Previous photo">
                  ‹
                </button>
                <button className="nav next" onClick={() => setI((i + 1) % shots.length)} aria-label="Next photo">
                  ›
                </button>
              </>
            )}
          </div>
          {shots.length > 1 && (
            <div className="thumbs">
              {shots.map((s, n) => (
                <button key={n} className={n === i ? "on" : ""} onClick={() => setI(n)} aria-label={`Photo ${n + 1}`}>
                  <img src={s} alt="" />
                </button>
              ))}
            </div>
          )}

          <div className="desc">
            <p className="micro gold">About this vehicle</p>
            <p>{car.description || "Call or text us for full details on this vehicle."}</p>
            {car.vin && (
              <p className="vin">
                <em>VIN</em> {car.vin}
              </p>
            )}
          </div>
        </div>

        <aside className="panel">
          <p className="micro gold">{car.sold ? "No longer available" : "Available now"}</p>
          <h1>{title(car)}</h1>
          <p className="price big">{money(car.price)}</p>
          <Rule />
          <dl className="specs">
            <div>
              <dt>Mileage</dt>
              <dd>{miles(car.mileage)} mi</dd>
            </div>
            <div>
              <dt>Year</dt>
              <dd>{car.year}</dd>
            </div>
            <div>
              <dt>Make</dt>
              <dd>{car.make}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>
                {car.model}
                {car.trim ? ` ${car.trim}` : ""}
              </dd>
            </div>
            <div>
              <dt>Condition</dt>
              <dd>{car.condition}</dd>
            </div>
          </dl>
          <div className="panel-cta">
            <a className="btn btn-gold wide" href={`tel:${DEALER.phoneHref}`}>
              Call {DEALER.phone}
            </a>
            <a
              className="btn btn-navy wide"
              href={`sms:${DEALER.phoneHref}?&body=${encodeURIComponent(
                `Hi, I'm interested in the ${title(car)} listed for ${money(car.price)}.`
              )}`}
            >
              Text about this car
            </a>
          </div>
          <LeadForm car={car} />
          <p className="panel-addr">
            {DEALER.address} · {DEALER.city}
            <br />
            <span className="foot-hours">{DEALER.hours}</span>
          </p>
        </aside>
      </div>

      <div className="stickybar">
        <div>
          <strong>{money(car.price)}</strong>
          <span>{title(car)}</span>
        </div>
        <a className="btn btn-gold" href={`tel:${DEALER.phoneHref}`}>
          Call
        </a>
        <a className="btn btn-ghost" href={`sms:${DEALER.phoneHref}`}>
          Text
        </a>
      </div>
    </main>
  );
}

function LeadForm({ car }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!name.trim() || !phone.trim()) {
      setErr("Add your name and a number we can reach you at.");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      await createLead({
        name: name.trim(),
        phone: phone.trim(),
        note: note.trim(),
        carId: car.id,
        carLabel: title(car),
        price: car.price,
      });
      setSent(true);
    } catch (e) {
      setErr(`That didn't send. Call or text ${DEALER.phone} instead.`);
    }
    setBusy(false);
  };

  if (sent)
    return (
      <div className="lead done">
        <p className="micro gold">Request sent</p>
        <p>
          Thanks {name.split(" ")[0]} — we'll call you about the {car.year} {car.make} shortly. In a hurry?
          Call {DEALER.phone}.
        </p>
      </div>
    );

  return (
    <div className="lead">
      <p className="micro gold">Or have us call you</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" />
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Phone number"
        inputMode="tel"
        aria-label="Your phone number"
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Best time to reach you (optional)"
        aria-label="Note"
      />
      {err && <p className="err">{err}</p>}
      <button className="btn btn-navy wide" disabled={busy} onClick={submit}>
        {busy ? "Sending…" : "Request info"}
      </button>
    </div>
  );
}

/* ============================================================
   ADMIN
   ============================================================ */
function Admin({ go, say }) {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [cars, setCars] = useState([]);
  const [leads, setLeads] = useState([]);
  const [sales, setSales] = useState([]);
  const [tab, setTab] = useState("inventory");
  const [editing, setEditing] = useState(null);
  const [editingSale, setEditingSale] = useState(null); // null | {} | {car} | {sale}
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const notify = useCallback((m) => {
    setToast(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const reload = useCallback(async () => {
    try {
      const [c, l, s] = await Promise.all([fetchAllCars(), fetchLeads(), fetchSales()]);
      setCars(c);
      setLeads(l);
      setSales(s);
    } catch (e) {
      notify("Couldn't load your inventory. Check your connection.");
    }
  }, [notify]);

  useEffect(() => {
    if (session) reload();
  }, [session, reload]);

  if (session === undefined) return <div className="gate" />;
  if (!session) return <SignIn go={go} />;

  const newLeads = leads.filter((l) => !l.handled).length;

  const patch = async (car, changes) => {
    try {
      const saved = await updateCar(car.id, changes);
      setCars((cs) => cs.map((c) => (c.id === car.id ? saved : c)));
    } catch (e) {
      notify("That change didn't save. Try again.");
    }
  };

  const remove = async (car) => {
    if (!window.confirm(`Delete the ${title(car)}? This removes the listing and its photos.`)) return;
    try {
      await deleteCar(car);
      setCars((cs) => cs.filter((c) => c.id !== car.id));
      notify("Listing deleted.");
    } catch (e) {
      notify("Couldn't delete that listing.");
    }
  };

  return (
    <div className="admin">
      <header className="adbar">
        <div className="wrap adbar-in">
          <div className="brand">
            <Badge size={40} />
            <span className="brand-txt">
              <strong>DEALER</strong>
              <em>DASHBOARD</em>
            </span>
          </div>
          <div className="adbar-right">
            <button className="btn btn-ghost" onClick={() => go("/")}>
              View website
            </button>
            <button className="btn btn-ghost" onClick={() => signOut()}>
              Sign out
            </button>
            <button
              className="btn btn-gold"
              onClick={() => {
                setEditing("new");
                setTab("inventory");
              }}
            >
              + Add a car
            </button>
          </div>
        </div>
        <div className="wrap tabs">
          <button className={tab === "inventory" ? "on" : ""} onClick={() => setTab("inventory")}>
            Inventory <span className="count">{cars.length}</span>
          </button>
          <button className={tab === "leads" ? "on" : ""} onClick={() => setTab("leads")}>
            Customer requests {newLeads > 0 && <span className="count hot">{newLeads}</span>}
          </button>
          <button className={tab === "sales" ? "on" : ""} onClick={() => setTab("sales")}>
            Sales <span className="count">{sales.length}</span>
          </button>
        </div>
      </header>

      <main className="wrap adbody">
        {editing && (
          <CarForm
            car={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={(saved, isNew) => {
              setCars((cs) => (isNew ? [saved, ...cs] : cs.map((c) => (c.id === saved.id ? saved : c))));
              setEditing(null);
              notify(isNew ? (saved.published ? "Car published." : "Saved as a draft.") : "Changes saved.");
            }}
            notify={notify}
          />
        )}

        {editingSale && (
          <SaleForm
            initial={editingSale}
            cars={cars}
            onCancel={() => setEditingSale(null)}
            onSaved={(saved, wasFinalized) => {
              setSales((ss) => {
                const exists = ss.some((x) => x.id === saved.id);
                return exists ? ss.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...ss];
              });
              if (wasFinalized && saved.car_id) {
                setCars((cs) => cs.map((c) => (c.id === saved.car_id ? { ...c, sold: true } : c)));
              }
              setEditingSale(null);
              notify(wasFinalized ? "Sale finalized — car marked sold." : "Buyer's order saved.");
            }}
            notify={notify}
          />
        )}

        {!editing && !editingSale && tab === "inventory" && (
          <Inventory
            cars={cars}
            onEdit={setEditing}
            onAdd={() => setEditing("new")}
            onSell={(car) => {
              setEditingSale({ car });
              setTab("sales");
            }}
            patch={patch}
            remove={remove}
            notify={notify}
          />
        )}

        {!editing && !editingSale && tab === "leads" && (
          <Leads
            leads={leads}
            onToggle={async (l) => {
              await updateLead(l.id, { handled: !l.handled });
              setLeads((ls) => ls.map((x) => (x.id === l.id ? { ...x, handled: !x.handled } : x)));
            }}
            onDelete={async (l) => {
              await deleteLead(l.id);
              setLeads((ls) => ls.filter((x) => x.id !== l.id));
            }}
          />
        )}

        {!editing && !editingSale && tab === "sales" && (
          <SalesList
            sales={sales}
            onNew={() => setEditingSale({})}
            onEdit={(sale) => setEditingSale({ sale })}
            onDelete={async (sale) => {
              if (!window.confirm("Delete this buyer's order? This does not un-sell the car.")) return;
              try {
                await deleteSale(sale.id);
                setSales((ss) => ss.filter((x) => x.id !== sale.id));
                notify("Buyer's order deleted.");
              } catch (e) {
                notify("Couldn't delete that record.");
              }
            }}
          />
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function SignIn({ go }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      await signIn(email.trim(), pw);
    } catch (e) {
      setErr("That email and password don't match an account.");
    }
    setBusy(false);
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <Badge size={64} />
        <h2>Dealer sign in</h2>
        <p>Sign in to manage inventory.</p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          aria-label="Email"
          style={{ letterSpacing: "normal" }}
        />
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Password"
          aria-label="Password"
        />
        {err && <p className="err">{err}</p>}
        <button className="btn btn-gold wide" disabled={busy} onClick={submit}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button className="linkish" onClick={() => go("/")}>
          ← Back to the website
        </button>
      </div>
    </div>
  );
}

function Inventory({ cars, onEdit, onAdd, onSell, patch, remove, notify }) {
  const live = cars.filter((c) => c.published && !c.sold).length;
  const sold = cars.filter((c) => c.sold).length;
  const drafts = cars.filter((c) => !c.published).length;

  if (!cars.length)
    return (
      <div className="empty">
        <Badge size={64} />
        <h3>No cars listed yet</h3>
        <p>Add your first car — photos, price, miles. It takes about a minute.</p>
        <button className="btn btn-gold" onClick={onAdd}>
          + Add a car
        </button>
      </div>
    );

  return (
    <>
      <div className="stats">
        <div>
          <strong>{live}</strong>
          <em>On the website</em>
        </div>
        <div>
          <strong>{drafts}</strong>
          <em>Drafts</em>
        </div>
        <div>
          <strong>{sold}</strong>
          <em>Sold</em>
        </div>
      </div>

      <div className="rows">
        {cars.map((c) => (
          <div key={c.id} className={"row" + (c.sold ? " is-sold" : "")}>
            <div className="row-img">{c.cover ? <img src={c.cover} alt="" /> : <CarGhost />}</div>
            <div className="row-main">
              <h3>{title(c)}</h3>
              <p className="row-meta">
                {money(c.price)} · {miles(c.mileage)} mi · {c.condition}
                {c.vin ? ` · VIN ${c.vin}` : ""}
              </p>
              <div className="chips">
                {c.sold ? (
                  <span className="chip chip-sold">Sold</span>
                ) : c.published ? (
                  <span className="chip chip-live">On the website</span>
                ) : (
                  <span className="chip">Draft</span>
                )}
                {c.featured && !c.sold && <span className="chip chip-feat">Featured</span>}
              </div>
            </div>
            <div className="row-acts">
              <button
                className="mini"
                onClick={() => {
                  patch(c, { published: !c.published });
                  notify(c.published ? "Taken off the website." : "Published to the website.");
                }}
              >
                {c.published ? "Unpublish" : "Publish"}
              </button>
              <button
                className="mini"
                onClick={() => {
                  patch(c, { sold: !c.sold });
                  notify(c.sold ? "Marked available again." : "Marked sold.");
                }}
              >
                {c.sold ? "Mark available" : "Mark sold"}
              </button>
                            <button
                className="mini"
                onClick={() => {
                  patch(c, { pending: !c.pending });
                  notify(c.pending ? "Back to available." : "Marked sale pending.");
                }}
              >
                {c.pending ? "Clear pending" : "Sale pending"}
              </button>
              {!c.sold && (
                <button className="mini" onClick={() => onSell(c)}>
                  Sell
                </button>
              )}
              <button className="mini" onClick={() => patch(c, { featured: !c.featured })}>
                {c.featured ? "Unfeature" : "Feature"}
              </button>
              <button className="mini" onClick={() => onEdit(c)}>
                Edit
              </button>
              <button className="mini danger" onClick={() => remove(c)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

const BLANK = {
  year: "",
  make: "",
  model: "",
  trim: "",
  price: "",
  mileage: "",
  condition: "Good",
  description: "",
  vin: "",
  featured: false,
};

/* ---------- repeatable {label, amount} rows — used for car expenses and buyer's-order line items ---------- */
function LineItems({ items, onChange, addLabel }) {
  const set = (i, key) => (e) => {
    const next = items.slice();
    next[i] = { ...next[i], [key]: e.target.value };
    onChange(next);
  };
  const add = () => onChange([...items, { label: "", amount: "" }]);
  const remove = (i) => onChange(items.filter((_, k) => k !== i));
  const total = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);

  return (
    <div className="lineitems">
      {items.map((it, i) => (
        <div className="lineitem" key={i}>
          <input value={it.label} onChange={set(i, "label")} placeholder="Description" />
          <input value={it.amount} onChange={set(i, "amount")} inputMode="numeric" placeholder="0.00" />
          <button type="button" onClick={() => remove(i)} aria-label="Remove line">
            ✕
          </button>
        </div>
      ))}
      <div className="lineitem-acts">
        <button type="button" className="linkish" onClick={add}>
          + {addLabel || "Add line"}
        </button>
        {items.length > 0 && <span className="lineitem-total">{money(total)}</span>}
      </div>
    </div>
  );
}

/* ---------- VIN barcode scanner (camera) ---------- */
function VinScanner({ onDetect, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const readerRef = useRef(null);
  const fileRef = useRef(null);
  const [err, setErr] = useState("");
  const [notVin, setNotVin] = useState("");
  const [busy, setBusy] = useState(false);
  const lastMisreadRef = useRef("");

  // Kept in refs (not effect deps) so a parent re-render while the modal is
  // open — e.g. the VIN-field's own onChange — can't tear down and restart
  // the live camera stream mid-scan.
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  const handleResultRef = useRef();
  handleResultRef.current = (text) => {
    if (isValidVin(text)) {
      controlsRef.current && controlsRef.current.stop();
      onDetectRef.current(text);
      return;
    }
    // Decoded *something*, just not a VIN — tell the user instead of staying
    // silent, but don't spam on repeated frames/attempts of the same miss.
    if (text && text !== lastMisreadRef.current) {
      lastMisreadRef.current = text;
      setNotVin("That barcode isn't a VIN. Try the driver's door jamb sticker, title, or window sticker.");
    } else if (!text) {
      setNotVin("Couldn't find a barcode in that photo. Try a closer, sharper, glare-free shot.");
    }
  };

  useEffect(() => {
    let live = true;
    Promise.all([import("@zxing/browser"), import("@zxing/library")]).then(
      ([{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }]) => {
        if (!live) return;
        // VIN barcodes are Code 39 per the automotive (AIAG) standard; some
        // dealer-installed window-sticker systems use Code 128 instead.
        // Narrowing the formats and forcing TRY_HARDER is what makes zxing
        // reliably read the small, dense bars on a door-jamb sticker.
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_39, BarcodeFormat.CODE_128]);
        hints.set(DecodeHintType.TRY_HARDER, true);
        const reader = new BrowserMultiFormatReader(hints);
        readerRef.current = reader;
        reader
          .decodeFromConstraints(
            {
              video: {
                facingMode: "environment",
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              },
            },
            videoRef.current,
            (result) => {
              if (!live || !result) return;
              handleResultRef.current(result.getText().trim().toUpperCase());
            }
          )
          .then((controls) => {
            if (!live) controls.stop();
            else controlsRef.current = controls;
          })
          .catch(() => live && setErr("Couldn't reach the camera. Check permissions, or type the VIN instead."));
      }
    );
    return () => {
      live = false;
      controlsRef.current && controlsRef.current.stop();
    };
  }, []);

  const scanPhoto = async (file) => {
    if (!file || !readerRef.current) return;
    setErr("");
    setBusy(true);
    const url = URL.createObjectURL(file);
    try {
      const result = await readerRef.current.decodeFromImageUrl(url);
      handleResultRef.current(result.getText().trim().toUpperCase());
    } catch (e) {
      handleResultRef.current("");
    } finally {
      URL.revokeObjectURL(url);
      setBusy(false);
    }
  };

  return (
    <div className="scan-modal" onClick={onClose}>
      <div className="scan-card" onClick={(e) => e.stopPropagation()}>
        <div className="scan-head">
          <p className="micro gold">Scan the VIN barcode</p>
          <button className="linkish" onClick={onClose}>
            Close
          </button>
        </div>
        <video ref={videoRef} className="scan-video" muted playsInline />
        <p className="scan-hint">
          Hold the barcode steady in frame — door jamb sticker, title, or window sticker all work.
        </p>
        <button
          type="button"
          className="mini"
          disabled={busy}
          onClick={() => fileRef.current && fileRef.current.click()}
        >
          {busy ? "Reading photo…" : "Camera won't lock on? Take a photo instead"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = "";
            if (f) scanPhoto(f);
          }}
        />
        {notVin && !err && <p className="scan-hint warn">{notVin}</p>}
        {err && <p className="err">{err}</p>}
      </div>
    </div>
  );
}

function CarForm({ car, onCancel, onSaved, notify }) {
  const [v, setV] = useState(car ? { ...BLANK, ...car } : BLANK);
  const [photos, setPhotos] = useState(car ? car.photos : []);
  const [cost, setCost] = useState("");
  const [expenses, setExpenses] = useState([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const fileRef = useRef(null);

  const runDecode = async (vin) => {
    if (!isValidVinFormat(vin)) {
      notify("That doesn't look like a complete 17-character VIN.");
      return;
    }
    setDecoding(true);
    try {
      const info = await decodeVin(vin);
      setV((prev) => {
        const next = { ...prev, vin };
        const fill = (key, val) => {
          if (val && !String(prev[key] || "").trim()) next[key] = val;
        };
        fill("year", info.year);
        fill("make", info.make);
        fill("model", info.model);
        fill("trim", info.trim);
        return next;
      });
      notify(`Decoded: ${info.year} ${info.make} ${info.model}`.trim());
    } catch (e) {
      notify("Couldn't decode that VIN. You can still fill the fields by hand.");
    }
    setDecoding(false);
  };

  const handleScanned = (vin) => {
    setScanOpen(false);
    setV((prev) => ({ ...prev, vin }));
    runDecode(vin);
  };

  useEffect(() => {
    if (!car) return;
    fetchCarCost(car.id)
      .then((c) => {
        if (c) {
          setCost(c.cost || "");
          setExpenses(c.expenses || []);
        }
      })
      .catch(() => {});
  }, [car]);

  const set = (k) => (e) =>
    setV({ ...v, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  const addFiles = async (files) => {
    const list = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, 15 - photos.length);
    if (!list.length) return;
    setUploading(list.length);
    for (const f of list) {
      try {
        const blob = await shrink(f);
        const shot = await uploadPhoto(blob);
        setPhotos((p) => [...p, shot]);
      } catch (e) {
        notify("A photo didn't upload. Try again.");
      }
      setUploading((n) => n - 1);
    }
  };

  const dropPhoto = async (n) => {
    const gone = photos[n];
    setPhotos(photos.filter((_, k) => k !== n));
    removePhotos([gone]).catch(() => {});
  };

  const move = (from, to) => {
    if (to < 0 || to >= photos.length) return;
    const next = photos.slice();
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setPhotos(next);
  };

  const save = async (publish) => {
    if (!v.year || !v.make || !v.model || v.price === "" || v.mileage === "") {
      setErr("Fill in year, make, model, price and mileage.");
      return;
    }
    setErr("");
    setBusy(true);
    const payload = {
      ...v,
      year: Number(v.year),
      price: Number(String(v.price).replace(/[^0-9.]/g, "")),
      mileage: Number(String(v.mileage).replace(/[^0-9.]/g, "")),
      make: v.make.trim(),
      model: v.model.trim(),
      trim: (v.trim || "").trim(),
      vin: (v.vin || "").trim(),
      description: (v.description || "").trim(),
      published: publish,
      sold: car ? car.sold : false,
      photos,
    };
    try {
      const saved = car ? await updateCar(car.id, payload) : await insertCar(payload);
      try {
        await upsertCarCost(saved.id, { cost: Number(cost) || 0, expenses });
      } catch (e) {
        notify("Saved the car, but the cost/expenses didn't save. Edit the car again to retry.");
      }
      onSaved(saved, !car);
    } catch (e) {
      setErr("That didn't save. Check your connection and try again.");
    }
    setBusy(false);
  };

  return (
    <div className="form">
      <div className="form-head">
        <h2>{car ? "Edit listing" : "Add a car"}</h2>
        <button className="linkish" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <div
        className={"drop" + (drag ? " over" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => fileRef.current && fileRef.current.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="micro gold">Photos</p>
        <p className="drop-title">Drag photos here, or tap to choose</p>
        <p className="drop-sub">
          {uploading > 0
            ? `Uploading ${uploading} more…`
            : `First photo is the one customers see in the grid. Up to 15 — ${photos.length} added.`}
        </p>
      </div>

      {photos.length > 0 && (
        <div className="shots">
          {photos.map((p, n) => (
            <div key={p.path || n} className="shot">
              <img src={p.url} alt="" />
              {n === 0 && <span className="shot-tag">Main photo</span>}
              <div className="shot-acts">
                <button onClick={() => move(n, n - 1)} aria-label="Move left">
                  ‹
                </button>
                <button onClick={() => dropPhoto(n)} aria-label="Remove photo">
                  ✕
                </button>
                <button onClick={() => move(n, n + 1)} aria-label="Move right">
                  ›
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="fields">
        <label>
          <span>Year</span>
          <input value={v.year} onChange={set("year")} inputMode="numeric" placeholder="2018" />
        </label>
        <label>
          <span>Make</span>
          <input value={v.make} onChange={set("make")} placeholder="Honda" />
        </label>
        <label>
          <span>Model</span>
          <input value={v.model} onChange={set("model")} placeholder="Accord" />
        </label>
        <label>
          <span>Trim (optional)</span>
          <input value={v.trim} onChange={set("trim")} placeholder="EX-L" />
        </label>
        <label>
          <span>Price</span>
          <input value={v.price} onChange={set("price")} inputMode="numeric" placeholder="14500" />
        </label>
        <label>
          <span>Mileage</span>
          <input value={v.mileage} onChange={set("mileage")} inputMode="numeric" placeholder="86000" />
        </label>
        <label>
          <span>Condition</span>
          <select value={v.condition} onChange={set("condition")}>
            <option>Excellent</option>
            <option>Good</option>
            <option>Fair</option>
          </select>
        </label>
        <label className="full">
          <span>VIN (optional)</span>
          <div className="vin-row">
            <input
              value={v.vin}
              onChange={set("vin")}
              placeholder="1HGCV1F34JA000000"
              maxLength={17}
              style={{ textTransform: "uppercase" }}
            />
            <button type="button" className="mini" onClick={() => setScanOpen(true)}>
              📷 Scan barcode
            </button>
            <button
              type="button"
              className="mini"
              disabled={decoding || !v.vin}
              onClick={() => runDecode((v.vin || "").trim().toUpperCase())}
            >
              {decoding ? "Decoding…" : "Decode VIN"}
            </button>
          </div>
        </label>
        <label className="full">
          <span>Short description</span>
          <textarea
            value={v.description}
            onChange={set("description")}
            rows={3}
            placeholder="One owner, clean inside and out, new tires, runs great."
          />
        </label>
        <label className="check full">
          <input type="checkbox" checked={!!v.featured} onChange={set("featured")} />
          <span>Feature this car at the top of the website</span>
        </label>
      </div>

      {scanOpen && <VinScanner onDetect={handleScanned} onClose={() => setScanOpen(false)} />}

      <div className="cost-section">
        <p className="micro gold">Cost &amp; expenses — private, never shown on the website</p>
        <div className="fields">
          <label>
            <span>What you paid for this car</span>
            <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="numeric" placeholder="0.00" />
          </label>
        </div>
        <p className="micro" style={{ marginTop: 14 }}>
          Other expenses (repairs, detailing, transport…)
        </p>
        <LineItems items={expenses} onChange={setExpenses} addLabel="Add expense" />
      </div>

      {err && <p className="err">{err}</p>}

      <div className="form-acts">
        <button className="btn btn-gold" disabled={busy || uploading > 0} onClick={() => save(true)}>
          {busy ? "Saving…" : car ? "Save and publish" : "Publish to the website"}
        </button>
        <button className="btn btn-navy" disabled={busy || uploading > 0} onClick={() => save(false)}>
          Save as draft
        </button>
        <button className="linkish" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Leads({ leads, onToggle, onDelete }) {
  if (!leads.length)
    return (
      <div className="empty">
        <Badge size={64} />
        <h3>No customer requests yet</h3>
        <p>When someone asks about a car on the website, their name and number land here.</p>
      </div>
    );

  const clean = (p) => p.replace(/[^0-9+]/g, "");

  return (
    <div className="rows">
      {leads.map((l) => (
        <div key={l.id} className={"row lead-row" + (l.handled ? " done" : "")}>
          <div className="row-main">
            <h3>{l.name}</h3>
            <p className="row-meta">
              <a href={`tel:${clean(l.phone)}`}>{l.phone}</a> · about the {l.carLabel} ({money(l.price)})
            </p>
            {l.note && <p className="lead-note">“{l.note}”</p>}
            <p className="micro">{new Date(l.at).toLocaleString()}</p>
          </div>
          <div className="row-acts">
            <a className="mini" href={`tel:${clean(l.phone)}`}>
              Call
            </a>
            <a className="mini" href={`sms:${clean(l.phone)}`}>
              Text
            </a>
            <button className="mini" onClick={() => onToggle(l)}>
              {l.handled ? "Mark new" : "Followed up"}
            </button>
            <button className="mini danger" onClick={() => onDelete(l)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   SALES — buyer's orders + records
   ============================================================ */
function SalesList({ sales, onNew, onEdit, onDelete }) {
  const finalizedSales = sales.filter((s) => s.finalized);
  const totalRevenue = finalizedSales.reduce((sum, s) => sum + saleTotals(s).totalDue, 0);
  const totalProfit = finalizedSales.reduce((sum, s) => sum + saleTotals(s).netProfit, 0);

  const exportCsv = () => {
    const csv = salesToCsv(sales);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `capital-auto-sales-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!sales.length)
    return (
      <div className="empty">
        <Badge size={64} />
        <h3>No sales recorded yet</h3>
        <p>Start a buyer's order from a car in Inventory, or start a blank one here.</p>
        <button className="btn btn-gold" onClick={onNew}>
          + New buyer's order
        </button>
      </div>
    );

  return (
    <>
      <div className="stats">
        <div>
          <strong>{finalizedSales.length}</strong>
          <em>Cars sold</em>
        </div>
        <div>
          <strong>{moneyCents(totalRevenue)}</strong>
          <em>Total collected</em>
        </div>
        <div>
          <strong>{moneyCents(totalProfit)}</strong>
          <em>Net profit</em>
        </div>
      </div>

      <div className="inv-head">
        <button className="btn btn-gold" onClick={onNew}>
          + New buyer's order
        </button>
        <button className="linkish" onClick={exportCsv}>
          Export CSV for taxes
        </button>
      </div>

      <div className="rows">
        {sales.map((s) => {
          const t = saleTotals(s);
          const v = s.vehicle || {};
          return (
            <div key={s.id} className="row">
              <div className="row-main">
                <h3>
                  {v.year} {v.make} {v.model}
                  {v.trim ? ` ${v.trim}` : ""}
                </h3>
                <p className="row-meta">
                  {(s.buyer && s.buyer.name) || "No buyer name yet"} · {s.sale_date} · Total{" "}
                  {moneyCents(t.totalDue)} · Profit {moneyCents(t.netProfit)}
                </p>
                <div className="chips">
                  {s.finalized ? (
                    <span className="chip chip-live">Finalized</span>
                  ) : (
                    <span className="chip">Draft</span>
                  )}
                </div>
              </div>
              <div className="row-acts">
                <button className="mini" onClick={() => onEdit(s)}>
                  {s.finalized ? "View / print" : "Continue"}
                </button>
                <button className="mini danger" onClick={() => onDelete(s)}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function CarPicker({ cars, onPick }) {
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    return cars
      .filter((c) => `${c.year} ${c.make} ${c.model} ${c.trim} ${c.vin}`.toLowerCase().includes(query))
      .slice(0, 8);
  }, [cars, q]);

  return (
    <div className="carpicker">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search your inventory by year, make, model or VIN…"
      />
      {matches.length > 0 && (
        <div className="carpicker-list">
          {matches.map((c) => (
            <button key={c.id} type="button" onClick={() => onPick(c)}>
              {title(c)} — {money(c.price)}
              {c.sold ? " (sold)" : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SaleForm({ initial, cars, onCancel, onSaved, notify }) {
  const existing = initial.sale || null;
  const [s, setS] = useState(() => (existing ? { ...BLANK_SALE, ...existing } : { ...BLANK_SALE }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const startedFromCar = useRef(false);

  const pickCar = useCallback((car) => {
    setS((prev) => ({
      ...prev,
      car_id: car.id,
      vehicle: { ...prev.vehicle, year: car.year, make: car.make, model: car.model, trim: car.trim || "", vin: car.vin || "", mileage: car.mileage },
      vehicle_price: car.price,
    }));
    fetchCarCost(car.id)
      .then((c) => {
        if (c) setS((prev) => ({ ...prev, car_cost: c.cost || 0, car_expenses: c.expenses || [] }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (existing || startedFromCar.current) return;
    if (initial.car) {
      startedFromCar.current = true;
      pickCar(initial.car);
    }
  }, [existing, initial.car, pickCar]);

  // keep the VA sales tax in sync with the subtotal as the dealer edits price/trade fields
  useEffect(() => {
    const cashPrice = (Number(s.vehicle_price) || 0) + (Number(s.processing_fee) || 0);
    const netTradeAllowance = (Number(s.gross_trade_allowance) || 0) - (Number(s.trade_payoff) || 0);
    const tax = calcVaTax(cashPrice - netTradeAllowance);
    setS((prev) => (Number(prev.sales_tax) === tax ? prev : { ...prev, sales_tax: tax }));
  }, [s.vehicle_price, s.processing_fee, s.gross_trade_allowance, s.trade_payoff]);

  const set = (path) => (e) => setS((prev) => setPath(prev, path, e.target.value));
  const totals = saleTotals(s);

  const buildPayload = () => ({
    car_id: s.car_id,
    sale_date: s.sale_date,
    stock_number: s.stock_number,
    vehicle: s.vehicle,
    buyer: s.buyer,
    co_buyer_name: s.co_buyer_name,
    trade_in: s.trade_in,
    insurance: s.insurance,
    lien_holder: s.lien_holder,
    remarks: s.remarks,
    salesperson: s.salesperson,
    vehicle_price: Number(s.vehicle_price) || 0,
    processing_fee: Number(s.processing_fee) || 0,
    gross_trade_allowance: Number(s.gross_trade_allowance) || 0,
    trade_payoff: Number(s.trade_payoff) || 0,
    sales_tax: Number(s.sales_tax) || 0,
    license_fee: Number(s.license_fee) || 0,
    title_fee: Number(s.title_fee) || 0,
    registration_fee: Number(s.registration_fee) || 0,
    highway_use_fee: Number(s.highway_use_fee) || 0,
    dealer_biz_tax: Number(s.dealer_biz_tax) || 0,
    online_filing_fee: Number(s.online_filing_fee) || 0,
    other_charges: s.other_charges,
    deposit: Number(s.deposit) || 0,
    down_payment: Number(s.down_payment) || 0,
    payment_type: s.payment_type,
    car_cost: Number(s.car_cost) || 0,
    car_expenses: s.car_expenses,
  });

  const save = async (finalize) => {
    if (finalize && !(s.buyer.name || "").trim()) {
      setErr("Add the buyer's name before finalizing.");
      return;
    }
    setErr("");
    setBusy(true);
    const payload = { ...buildPayload(), finalized: finalize || !!(existing && existing.finalized) };
    try {
      const saved = existing ? await updateSale(existing.id, payload) : await createSale(payload);
      if (finalize && saved.car_id) {
        try {
          await updateCar(saved.car_id, { sold: true });
        } catch (e) {
          notify("Sale saved, but couldn't mark the car sold — do it from Inventory.");
        }
      }
      onSaved(saved, finalize);
    } catch (e) {
      setErr("That didn't save. Check your connection and try again.");
    }
    setBusy(false);
  };

  return (
    <div className="form saleform">
      <div className="form-head">
        <h2>{existing ? "Buyer's order" : "New buyer's order"}</h2>
        <button className="linkish" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {!s.car_id && (
        <div className="sale-section">
          <p className="micro gold">Pick the car being sold</p>
          <CarPicker cars={cars} onPick={pickCar} />
        </div>
      )}

      <div className="sale-grid">
        <div>
          <div className="sale-section">
            <p className="micro gold">Order</p>
            <div className="fields">
              <label>
                <span>Date</span>
                <input type="date" value={s.sale_date} onChange={set("sale_date")} />
              </label>
              <label>
                <span>Stock #</span>
                <input value={s.stock_number} onChange={set("stock_number")} />
              </label>
              <label>
                <span>Salesperson</span>
                <input value={s.salesperson} onChange={set("salesperson")} />
              </label>
            </div>
          </div>

          <div className="sale-section">
            <p className="micro gold">Buyer information</p>
            <div className="fields">
              <label className="full">
                <span>Name</span>
                <input value={s.buyer.name} onChange={set("buyer.name")} />
              </label>
              <label className="full">
                <span>Address</span>
                <input value={s.buyer.address} onChange={set("buyer.address")} />
              </label>
              <label>
                <span>City</span>
                <input value={s.buyer.city} onChange={set("buyer.city")} />
              </label>
              <label>
                <span>State</span>
                <input value={s.buyer.state} onChange={set("buyer.state")} />
              </label>
              <label>
                <span>Zip</span>
                <input value={s.buyer.zip} onChange={set("buyer.zip")} />
              </label>
              <label>
                <span>Home phone</span>
                <input value={s.buyer.homePhone} onChange={set("buyer.homePhone")} />
              </label>
              <label>
                <span>Cell phone</span>
                <input value={s.buyer.cellPhone} onChange={set("buyer.cellPhone")} />
              </label>
              <label>
                <span>Work phone</span>
                <input value={s.buyer.workPhone} onChange={set("buyer.workPhone")} />
              </label>
              <label>
                <span>DL / State ID #</span>
                <input value={s.buyer.dlNumber} onChange={set("buyer.dlNumber")} />
              </label>
              <label>
                <span>DL state</span>
                <input value={s.buyer.dlState} onChange={set("buyer.dlState")} />
              </label>
              <label>
                <span>DOB</span>
                <input type="date" value={s.buyer.dob} onChange={set("buyer.dob")} />
              </label>
              <label>
                <span>County</span>
                <input value={s.buyer.county} onChange={set("buyer.county")} />
              </label>
              <label>
                <span>DL exp. date</span>
                <input type="date" value={s.buyer.dlExp} onChange={set("buyer.dlExp")} />
              </label>
              <label className="full">
                <span>Co-buyer name (optional)</span>
                <input value={s.co_buyer_name} onChange={set("co_buyer_name")} />
              </label>
            </div>
          </div>

          <div className="sale-section">
            <p className="micro gold">Vehicle information</p>
            <div className="fields">
              <label>
                <span>New / Used / Demo</span>
                <select value={s.vehicle.newUsed} onChange={set("vehicle.newUsed")}>
                  <option>Used</option>
                  <option>New</option>
                  <option>Demo</option>
                </select>
              </label>
              <label>
                <span>Year</span>
                <input value={s.vehicle.year} onChange={set("vehicle.year")} inputMode="numeric" />
              </label>
              <label>
                <span>Make</span>
                <input value={s.vehicle.make} onChange={set("vehicle.make")} />
              </label>
              <label>
                <span>Model</span>
                <input value={s.vehicle.model} onChange={set("vehicle.model")} />
              </label>
              <label>
                <span>Trim</span>
                <input value={s.vehicle.trim} onChange={set("vehicle.trim")} />
              </label>
              <label>
                <span>Body</span>
                <input value={s.vehicle.body} onChange={set("vehicle.body")} placeholder="Sedan, SUV…" />
              </label>
              <label>
                <span>Color 1</span>
                <input value={s.vehicle.color1} onChange={set("vehicle.color1")} />
              </label>
              <label>
                <span>Color 2</span>
                <input value={s.vehicle.color2} onChange={set("vehicle.color2")} />
              </label>
              <label>
                <span>Style</span>
                <input value={s.vehicle.style} onChange={set("vehicle.style")} />
              </label>
              <label>
                <span>Cylinders</span>
                <input value={s.vehicle.cyl} onChange={set("vehicle.cyl")} />
              </label>
              <label>
                <span>Transmission</span>
                <input value={s.vehicle.trans} onChange={set("vehicle.trans")} placeholder="Automatic" />
              </label>
              <label>
                <span>Mileage</span>
                <input value={s.vehicle.mileage} onChange={set("vehicle.mileage")} inputMode="numeric" />
              </label>
              <label className="full">
                <span>VIN</span>
                <input value={s.vehicle.vin} onChange={set("vehicle.vin")} />
              </label>
            </div>
          </div>

          <div className="sale-section">
            <p className="micro gold">Trade-in (optional)</p>
            <div className="fields">
              <label>
                <span>Year</span>
                <input value={s.trade_in.year} onChange={set("trade_in.year")} inputMode="numeric" />
              </label>
              <label>
                <span>Make</span>
                <input value={s.trade_in.make} onChange={set("trade_in.make")} />
              </label>
              <label>
                <span>Model</span>
                <input value={s.trade_in.model} onChange={set("trade_in.model")} />
              </label>
              <label>
                <span>Body</span>
                <input value={s.trade_in.body} onChange={set("trade_in.body")} />
              </label>
              <label>
                <span>Color</span>
                <input value={s.trade_in.color} onChange={set("trade_in.color")} />
              </label>
              <label>
                <span>Mileage</span>
                <input value={s.trade_in.mileage} onChange={set("trade_in.mileage")} inputMode="numeric" />
              </label>
              <label className="full">
                <span>VIN</span>
                <input value={s.trade_in.vin} onChange={set("trade_in.vin")} />
              </label>
              <label>
                <span>Balance owed to</span>
                <input value={s.trade_in.balanceOwedTo} onChange={set("trade_in.balanceOwedTo")} />
              </label>
              <label>
                <span>Balance owed</span>
                <input value={s.trade_in.balanceOwed} onChange={set("trade_in.balanceOwed")} inputMode="numeric" />
              </label>
              <label>
                <span>Good through</span>
                <input type="date" value={s.trade_in.goodThrough} onChange={set("trade_in.goodThrough")} />
              </label>
              <label>
                <span>Quoted by</span>
                <input value={s.trade_in.quotedBy} onChange={set("trade_in.quotedBy")} />
              </label>
            </div>
          </div>

          <div className="sale-section">
            <p className="micro gold">Insurance (optional)</p>
            <div className="fields">
              <label>
                <span>Company</span>
                <input value={s.insurance.company} onChange={set("insurance.company")} />
              </label>
              <label>
                <span>Policy #</span>
                <input value={s.insurance.policy} onChange={set("insurance.policy")} />
              </label>
              <label>
                <span>Agent</span>
                <input value={s.insurance.agent} onChange={set("insurance.agent")} />
              </label>
              <label>
                <span>Phone</span>
                <input value={s.insurance.phone} onChange={set("insurance.phone")} />
              </label>
            </div>
          </div>

          <div className="sale-section">
            <p className="micro gold">Lien holder (if financed)</p>
            <div className="fields">
              <label className="full">
                <span>Company</span>
                <input value={s.lien_holder.company} onChange={set("lien_holder.company")} />
              </label>
              <label className="full">
                <span>Street</span>
                <input value={s.lien_holder.street} onChange={set("lien_holder.street")} />
              </label>
              <label className="full">
                <span>City, state, zip</span>
                <input value={s.lien_holder.cityStateZip} onChange={set("lien_holder.cityStateZip")} />
              </label>
            </div>
          </div>

          <div className="sale-section">
            <p className="micro gold">Remarks</p>
            <textarea value={s.remarks} onChange={set("remarks")} rows={3} />
          </div>
        </div>

        <aside className="settle">
          <p className="micro gold">Settlement</p>

          <label>
            <span>Vehicle price</span>
            <input value={s.vehicle_price} onChange={set("vehicle_price")} inputMode="numeric" />
          </label>
          <label>
            <span>Processing fee</span>
            <input value={s.processing_fee} onChange={set("processing_fee")} inputMode="numeric" />
          </label>
          <div className="settle-row strong">
            <span>Cash price</span>
            <strong>{moneyCents(totals.cashPrice)}</strong>
          </div>

          <label>
            <span>Gross trade-in allowance</span>
            <input value={s.gross_trade_allowance} onChange={set("gross_trade_allowance")} inputMode="numeric" />
          </label>
          <label>
            <span>Less payoff</span>
            <input value={s.trade_payoff} onChange={set("trade_payoff")} inputMode="numeric" />
          </label>
          <div className="settle-row strong">
            <span>Net trade-in allowance</span>
            <strong>{moneyCents(totals.netTradeAllowance)}</strong>
          </div>
          <div className="settle-row strong">
            <span>Subtotal</span>
            <strong>{moneyCents(totals.subtotal)}</strong>
          </div>

          <Rule />
          <p className="micro">Taxes &amp; fees</p>
          <div className="settle-row">
            <span>4.15% VA sales &amp; use tax</span>
            <strong>{moneyCents(s.sales_tax)}</strong>
          </div>
          <label>
            <span>License fee</span>
            <input value={s.license_fee} onChange={set("license_fee")} inputMode="numeric" />
          </label>
          <label>
            <span>Title fee</span>
            <input value={s.title_fee} onChange={set("title_fee")} inputMode="numeric" />
          </label>
          <label>
            <span>Registration fee</span>
            <input value={s.registration_fee} onChange={set("registration_fee")} inputMode="numeric" />
          </label>
          <label>
            <span>Highway use fee</span>
            <input value={s.highway_use_fee} onChange={set("highway_use_fee")} inputMode="numeric" />
          </label>
          <label>
            <span>Dealer's business license tax</span>
            <input value={s.dealer_biz_tax} onChange={set("dealer_biz_tax")} inputMode="numeric" />
          </label>
          <label>
            <span>On-line systems filing fee</span>
            <input value={s.online_filing_fee} onChange={set("online_filing_fee")} inputMode="numeric" />
          </label>
          <p className="micro" style={{ marginTop: 10 }}>
            Other charges
          </p>
          <LineItems items={s.other_charges} onChange={(v) => setS((prev) => ({ ...prev, other_charges: v }))} addLabel="Add charge" />

          <div className="settle-row strong big">
            <span>Total due</span>
            <strong>{moneyCents(totals.totalDue)}</strong>
          </div>

          <Rule />
          <p className="micro">Credit</p>
          <label>
            <span>Deposit</span>
            <input value={s.deposit} onChange={set("deposit")} inputMode="numeric" />
          </label>
          <label>
            <span>Total down payment</span>
            <input value={s.down_payment} onChange={set("down_payment")} inputMode="numeric" />
          </label>
          <div className="settle-row strong">
            <span>Total credit</span>
            <strong>{moneyCents(totals.totalCredit)}</strong>
          </div>
          <div className="settle-row strong big">
            <span>Balance due</span>
            <strong>{moneyCents(totals.balanceDue)}</strong>
          </div>

          <label>
            <span>Payment type</span>
            <select value={s.payment_type} onChange={set("payment_type")}>
              <option value="cash">Cash</option>
              <option value="finance">Finance</option>
            </select>
          </label>

          {s.car_id && (
            <p className="micro" style={{ marginTop: 14 }}>
              Est. net profit: <strong>{moneyCents(totals.netProfit)}</strong>
            </p>
          )}
        </aside>
      </div>

      {err && <p className="err">{err}</p>}

      <div className="form-acts">
        <button className="btn btn-gold" disabled={busy} onClick={() => save(true)}>
          {busy ? "Saving…" : "Finalize sale"}
        </button>
        <button className="btn btn-navy" disabled={busy} onClick={() => save(false)}>
          Save without finalizing
        </button>
        <button className="linkish" onClick={() => window.print()}>
          Print / save as PDF
        </button>
        <button className="linkish" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <SaleDocument s={s} totals={totals} />
    </div>
  );
}

function Row({ label, value, strong, big }) {
  return (
    <div className={"doc-row" + (strong ? " strong" : "") + (big ? " big" : "")}>
      <span>{label}</span>
      <span>{moneyCents(value)}</span>
    </div>
  );
}

function SaleDocument({ s, totals }) {
  const v = s.vehicle || {};
  const b = s.buyer || {};
  const t = s.trade_in || {};
  const ins = s.insurance || {};
  const lien = s.lien_holder || {};
  const hasTrade = t.year || t.make || t.vin;
  const hasInsurance = ins.company || ins.policy;
  const hasLien = lien.company;

  return (
    <div className="print-area sale-doc">
      <div className="doc-head">
        <h2>BUYER'S ORDER</h2>
        <div>
          <span>DATE: {s.sale_date}</span>
          <span>STOCK #: {s.stock_number}</span>
        </div>
      </div>

      <div className="doc-grid">
        <div className="doc-col">
          <section>
            <h4>Buyer information</h4>
            <p>{b.name}</p>
            <p>{b.address}</p>
            <p>
              {b.city}, {b.state} {b.zip}
            </p>
            <p>
              Home {b.homePhone} · Cell {b.cellPhone} · Work {b.workPhone}
            </p>
            <p>
              DL/State ID # {b.dlNumber} ({b.dlState}) · DOB {b.dob}
            </p>
            <p>
              County {b.county} · Exp {b.dlExp}
            </p>
            {s.co_buyer_name && <p>Co-buyer: {s.co_buyer_name}</p>}
          </section>

          <section>
            <h4>Vehicle information — {v.newUsed}</h4>
            <p>
              {v.year} {v.make} {v.model} {v.trim} {v.body ? `— ${v.body}` : ""}
            </p>
            <p>
              Color {v.color1}
              {v.color2 ? ` / ${v.color2}` : ""} · Style {v.style} · Cyl {v.cyl} · Trans {v.trans}
            </p>
            <p>
              VIN {v.vin} · Mileage {miles(v.mileage)}
            </p>
          </section>

          {hasTrade && (
            <section>
              <h4>Trade-in information</h4>
              <p>
                {t.year} {t.make} {t.model} {t.body ? `— ${t.body}` : ""}
              </p>
              <p>
                VIN {t.vin} · Color {t.color} · Mileage {miles(t.mileage)}
              </p>
              <p>
                Balance owed to {t.balanceOwedTo}: {moneyCents(t.balanceOwed)} · Allowance{" "}
                {moneyCents(t.allowance)}
              </p>
              <p>
                Good through {t.goodThrough} · Quoted by {t.quotedBy}
              </p>
            </section>
          )}

          {hasInsurance && (
            <section>
              <h4>Insurance</h4>
              <p>
                {ins.company} · Policy #{ins.policy}
              </p>
              <p>
                {ins.agent} · {ins.phone}
              </p>
            </section>
          )}

          {hasLien && (
            <section>
              <h4>Lien holder</h4>
              <p>{lien.company}</p>
              <p>{lien.street}</p>
              <p>{lien.cityStateZip}</p>
            </section>
          )}

          {s.remarks && (
            <section>
              <h4>Remarks</h4>
              <p>{s.remarks}</p>
            </section>
          )}
        </div>

        <div className="doc-col">
          <section>
            <h4>Seller information</h4>
            <p>
              <strong>{DEALER.name}</strong>
            </p>
            <p>{DEALER.address}</p>
            <p>{DEALER.city}</p>
            <p>{DEALER.phone}</p>
            <p>Salesperson: {s.salesperson}</p>
          </section>

          <section className="doc-settlement">
            <h4>Settlement</h4>
            <Row label="Vehicle price" value={s.vehicle_price} />
            <Row label="Processing fee" value={s.processing_fee} />
            <Row label="Cash price" value={totals.cashPrice} strong />
            <Row label="Gross trade-in allowance" value={s.gross_trade_allowance} />
            <Row label="Less payoff" value={s.trade_payoff} />
            <Row label="Net trade-in allowance" value={totals.netTradeAllowance} strong />
            <Row label="Subtotal" value={totals.subtotal} strong />
            <Row label="4.15% VA sales & use tax" value={s.sales_tax} />
            <Row label="License fee" value={s.license_fee} />
            <Row label="Title fee" value={s.title_fee} />
            <Row label="Registration fee" value={s.registration_fee} />
            <Row label="Highway use fee" value={s.highway_use_fee} />
            <Row label="Dealer's business license tax" value={s.dealer_biz_tax} />
            <Row label="On-line systems filing fee" value={s.online_filing_fee} />
            {(s.other_charges || []).map((c, i) => (
              <Row key={i} label={c.label || "Other charge"} value={c.amount} />
            ))}
            <Row label="Total due" value={totals.totalDue} strong />
            <Row label="Deposit" value={s.deposit} />
            <Row label="Total down payment" value={s.down_payment} />
            <Row label="Total credit" value={totals.totalCredit} strong />
            <Row label="Balance due" value={totals.balanceDue} strong big />
            <p className="micro" style={{ marginTop: 6 }}>
              Payment: {s.payment_type === "finance" ? "Finance" : "Cash"}
            </p>
          </section>
        </div>
      </div>

      <div className="doc-asis">
        <p>
          <strong>FOR "AS IS" SALE ONLY:</strong> I understand that this vehicle is being sold "AS IS" WITH ALL
          FAULTS, and is not covered by any dealer warranty. I understand that the dealer is not required to
          make any repairs after I buy this vehicle. I will have to pay for any repairs this vehicle will need.
        </p>
        <p className="doc-sign-line">Date: _______________ Signature: X ___________________________</p>
      </div>

      <div className="doc-noliab">NO LIABILITY INSURANCE INCLUDED</div>

      <p className="doc-legal">
        By executing this order, Buyer acknowledges that they have read and agree to be bound by all of its
        terms, and that Buyer has received a fully completed copy. Buyer certifies they are 18 years of age or
        older.
      </p>

      <div className="doc-signatures">
        <div>
          <span className="doc-sign-line">X ___________________________ ___________</span>
          <span className="micro">BUYER · DATE</span>
        </div>
        <div>
          <span className="doc-sign-line">X ___________________________ ___________</span>
          <span className="micro">CO-BUYER · DATE</span>
        </div>
        <div>
          <span className="doc-sign-line">X ___________________________ ___________</span>
          <span className="micro">ACCEPTED BY AUTHORIZED REPRESENTATIVE · DATE</span>
        </div>
      </div>

      <p className="doc-foot">
        {DEALER.name} — {DEALER.address}, {DEALER.city} — {DEALER.phone} · Page 1 of 1
      </p>
    </div>
  );
}
