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
  signIn,
  signOut,
} from "./lib/db.js";

/* ============================================================
   YOUR BUSINESS DETAILS — edit this block and nothing else
   ============================================================ */
export const DEALER = {
  name: "Capital Auto Sales",
  phone: "804-372-4422",
  phoneHref: "+18043724422",
  address: "8607", // <-- add the rest of the street address
  city: "Richmond, VA",
  hours: "Mon–Sat 9am – 7pm  ·  Sun by appointment",
};

/* ---------- helpers ---------- */
const money = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Number(n) || 0
  );
const miles = (n) => new Intl.NumberFormat("en-US").format(Number(n) || 0);
const title = (c) => `${c.year} ${c.make} ${c.model}${c.trim ? " " + c.trim : ""}`.trim();

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
        <CarPage car={cars.find((c) => c.id === carId)} go={go} />
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
        const hay = `${c.year} ${c.make} ${c.model} ${c.trim} ${c.description}`.toLowerCase();
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
      <button className="card-hit" onClick={onClick} aria-label={`View ${title(car)}`}>
        <div className="card-img">
          {car.cover ? <img src={car.cover} alt={title(car)} loading="lazy" /> : <CarGhost />}
          {car.sold && <span className="tag tag-sold">Sold</span>}
          {!car.sold && car.featured && <span className="tag tag-feat">Featured</span>}
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
      </button>
    </article>
  );
}

/* ---------- car detail ---------- */
function CarPage({ car, go }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (car) document.title = `${title(car)} — ${DEALER.name}`;
    return () => {
      document.title = `${DEALER.name} — Quality Pre-Owned Cars in Richmond, VA`;
    };
  }, [car]);

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
  const [tab, setTab] = useState("inventory");
  const [editing, setEditing] = useState(null);
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
      const [c, l] = await Promise.all([fetchAllCars(), fetchLeads()]);
      setCars(c);
      setLeads(l);
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

        {!editing && tab === "inventory" && (
          <Inventory
            cars={cars}
            onEdit={setEditing}
            onAdd={() => setEditing("new")}
            patch={patch}
            remove={remove}
            notify={notify}
          />
        )}

        {!editing && tab === "leads" && (
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

function Inventory({ cars, onEdit, onAdd, patch, remove, notify }) {
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

function CarForm({ car, onCancel, onSaved, notify }) {
  const [v, setV] = useState(car ? { ...BLANK, ...car } : BLANK);
  const [photos, setPhotos] = useState(car ? car.photos : []);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

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
        <label>
          <span>VIN (optional)</span>
          <input value={v.vin} onChange={set("vin")} placeholder="1HGCV1F34JA000000" />
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
