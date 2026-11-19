import React, { useState, useEffect, useMemo, useCallback } from "react";
import { PrintPortal, usePrintDoc } from "./App.jsx";
import { uploadDocument } from "./lib/documents.js";
import CarRecon, { carLabel } from "./CarRecon.jsx";
import {
  DEFAULT_SETTINGS,
  STATUSES,
  STATUS_LABEL,
  LINE_KINDS,
  EXP_CATS,
  INC_CATS,
  SERVICE_TYPES,
  MONTH_NAMES,
  n2,
  ticketTotals,
  dealerCost,
  periodReport,
  monthlyTable,
  reconByCar,
  nextTicketNumber,
  tablesMissing,
  fetchTickets,
  saveTicket,
  deleteTicket,
  fetchLedger,
  addLedger,
  deleteLedger,
  fetchSettings,
  saveSettings,
} from "./lib/shop.js";

const cents = (n) => "$" + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const dateShort = (s) => {
  if (!s) return "";
  const [y, m, d] = String(s).split("-");
  return `${m}/${d}/${String(y).slice(2)}`;
};
const vehText = (v) => [v && v.year, v && v.make, v && v.model].filter(Boolean).join(" ") || "Vehicle not entered";

const SQL_HELP =
  "The shop tables aren't set up yet. Open Supabase → SQL Editor and run the last section of supabase/schema.sql (headed “repair shops”), then reload.";

export default function Shop({ cars, notify }) {
  const [tickets, setTickets] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [missing, setMissing] = useState(false);
  const [sub, setSub] = useState("tickets");
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      const [t, l, s] = await Promise.all([fetchTickets(), fetchLedger(), fetchSettings()]);
      setTickets(t);
      setLedger(l);
      setSettings(s);
      setMissing(false);
    } catch (e) {
      if (tablesMissing(e)) {
        setMissing(true);
        setTickets([]);
      } else notify("Couldn't load the shop records. Check your connection.");
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);
  // Pick up what someone else entered when coming back to this window.
  useEffect(() => {
    const onFocus = () => !editing && load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load, editing]);

  if (missing) {
    return (
      <div className="form">
        <p className="micro gold">Repair shops</p>
        <p className="scan-hint warn">{SQL_HELP}</p>
      </div>
    );
  }

  if (editing) {
    return (
      <TicketForm
        initial={editing}
        tickets={tickets || []}
        cars={cars}
        settings={settings}
        notify={notify}
        onCancel={() => setEditing(null)}
        onSaved={(saved) => {
          setTickets((ts) => (ts.some((x) => x.id === saved.id) ? ts.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...ts]));
          setEditing(null);
        }}
        onDeleted={(id) => {
          setTickets((ts) => ts.filter((x) => x.id !== id));
          setEditing(null);
        }}
      />
    );
  }

  const SUBS = [
    ["tickets", "Work tickets"],
    ["money", "Money in / out"],
    ["reports", "Monthly income"],
    ["recon", "Inventory recon"],
    ["setup", "Shop setup"],
  ];

  return (
    <div className="form">
      <p className="micro gold">Repair shops</p>
      <div className="shop-sub">
        {SUBS.map(([k, label]) => (
          <button key={k} className={sub === k ? "on" : ""} onClick={() => setSub(k)}>
            {label}
          </button>
        ))}
      </div>
      {tickets === null ? (
        <p className="scan-hint">Loading…</p>
      ) : (
        <>
          {sub === "tickets" && <TicketsView tickets={tickets} settings={settings} cars={cars} onOpen={setEditing} />}
          {sub === "money" && <MoneyView ledger={ledger} setLedger={setLedger} settings={settings} notify={notify} />}
          {sub === "reports" && <ReportsView tickets={tickets} ledger={ledger} settings={settings} />}
          {sub === "recon" && <ReconView tickets={tickets} cars={cars} settings={settings} onOpen={setEditing} />}
          {sub === "setup" && <SetupView settings={settings} setSettings={setSettings} notify={notify} />}
        </>
      )}
    </div>
  );
}

const shopName = (settings, id) => (id === "gen" ? "General / dealership" : (settings.shops.find((s) => s.id === id) || {}).name || "Unknown shop");

function blankTicket(settings, tickets, shop) {
  return {
    id: null,
    num: nextTicketNumber(tickets),
    date: todayStr(),
    shop: shop || settings.shops[0].id,
    source: "outside",
    status: "open",
    carId: null,
    customer: { name: "", phone: "" },
    vehicle: { year: "", make: "", model: "", trim: "", color: "", vin: "", miles: "" },
    concern: "",
    services: [],
    tech: "",
    lines: [{ kind: "labor", desc: "", qty: 1, unit: settings.laborRate, cost: 0 }],
    taxRate: settings.taxRate,
    paidAmount: 0,
    paidMethod: "",
    notes: "",
    closedAt: null,
  };
}

/* ---------- tickets list ---------- */
// A dealer ticket for a car in inventory, with everything we know about the car.
function carTicket(car, settings, tickets, shop) {
  const t = blankTicket(settings, tickets, shop);
  return {
    ...t,
    source: "dealer",
    taxRate: 0,
    carId: car.id,
    vehicle: { year: String(car.year || ""), make: car.make || "", model: car.model || "", trim: car.trim || "", color: car.color || "", vin: car.vin || "", miles: car.mileage ? String(car.mileage) : "" },
  };
}

function TicketsView({ tickets, settings, cars, onOpen }) {
  const [shop, setShop] = useState("all");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("active");
  const [q, setQ] = useState("");
  const [printDoc, setPrintDoc] = usePrintDoc();
  const [pick, setPick] = useState("");
  const shopArg = shop !== "all" ? shop : null;
  // Inventory cars (drafts and sold included) that match what was typed — a VIN,
  // or part of the year/make/model — so a ticket can start from the car.
  const needleQ = q.trim().toLowerCase();
  const carMatches =
    needleQ.length >= 3
      ? cars.filter((c) => [c.vin, c.year, c.make, c.model, c.trim, c.color].join(" ").toLowerCase().includes(needleQ)).slice(0, 5)
      : [];
  const pickedCar = cars.find((c) => c.id === pick);

  const live = tickets.filter((t) => t.status !== "void");
  const shown = tickets
    .filter((t) => {
      if (shop !== "all" && t.shop !== shop) return false;
      if (source !== "all" && t.source !== source) return false;
      if (status === "active" && (t.status === "closed" || t.status === "void")) return false;
      if (status !== "active" && status !== "all" && t.status !== status) return false;
      const needle = q.trim().toLowerCase();
      if (!needle) return true;
      return [t.num, t.customer.name, t.customer.phone, t.vehicle.vin, t.vehicle.year, t.vehicle.make, t.vehicle.model, t.concern].join(" ").toLowerCase().includes(needle);
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || String(b.num).localeCompare(String(a.num), undefined, { numeric: true }));

  return (
    <>
      <p className="scan-hint" style={{ margin: "10px 0 14px" }}>
        Every car that goes into a bay gets a ticket: which shop, <b>dealer inventory</b> (our own car — cost goes on that car) or <b>outside customer</b> (income).
        Print the ticket for the mechanic, then photograph the filled-in copy and attach it to the ticket.
      </p>
      <div className="stats shop-board">
        {settings.shops.map((s) => {
          const act = live.filter((t) => t.shop === s.id && t.status !== "closed");
          return (
            <button key={s.id} className={shop === s.id ? "on" : ""} onClick={() => setShop(shop === s.id ? "all" : s.id)}>
              <strong>{act.length}</strong>
              <em>{s.name}</em>
              <span className="scan-hint">
                {act.filter((t) => t.source === "dealer").length} dealer · {act.filter((t) => t.source === "outside").length} outside
              </span>
            </button>
          );
        })}
      </div>
      <div className="docs-audit-filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ticket #, customer — or type a VIN to find the car in inventory…" />
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Customer type">
          <option value="all">All work</option>
          <option value="dealer">Dealer inventory</option>
          <option value="outside">Outside customers</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="active">Active (not closed)</option>
          <option value="all">All statuses</option>
          {STATUSES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {carMatches.length > 0 && (
        <div className="shop-carhits">
          <p className="micro gold">In our inventory</p>
          {carMatches.map((c) => (
            <div key={c.id} className="shop-carhit">
              <span>{carLabel(c)}</span>
              <button className="mini" onClick={() => onOpen(carTicket(c, settings, tickets, shopArg))}>
                New ticket
              </button>
              <button className="mini" onClick={() => setPrintDoc({ ticket: carTicket(c, settings, tickets, shopArg) })}>
                Print ticket
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="shop-actions">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Inventory car" className="shop-carpick">
          <option value="">Ticket for an inventory car…</option>
          {[...cars].sort((a, b) => Number(a.sold) - Number(b.sold) || (b.year || 0) - (a.year || 0)).map((c) => (
            <option key={c.id} value={c.id}>
              {carLabel(c)}
            </option>
          ))}
        </select>
        {pickedCar && (
          <>
            <button className="btn btn-gold" onClick={() => onOpen(carTicket(pickedCar, settings, tickets, shopArg))}>
              Open ticket
            </button>
            <button className="btn btn-navy" onClick={() => setPrintDoc({ ticket: carTicket(pickedCar, settings, tickets, shopArg) })}>
              Print ticket
            </button>
          </>
        )}
      </div>
      <div className="shop-actions">
        <button className="btn btn-gold" onClick={() => onOpen(blankTicket(settings, tickets, shopArg))}>
          + New ticket
        </button>
        <button
          className="btn btn-navy"
          onClick={() => setPrintDoc({ ticket: blankTicket(settings, tickets, shopArg), blank: true })}
        >
          Print blank ticket
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="scan-hint" style={{ marginTop: 14 }}>
          {tickets.length ? "No tickets match." : "No tickets yet. Open one when a car goes into a bay."}
        </p>
      ) : (
        <div className="rows" style={{ marginTop: 14 }}>
          {shown.map((t) => {
            const r = ticketTotals(t);
            return (
              <div key={t.id} className="row">
                <div className="row-main">
                  <h3>
                    {t.num} · {vehText(t.vehicle)}
                  </h3>
                  <p className="row-meta">
                    {dateShort(t.date)} · {shopName(settings, t.shop)} ·{" "}
                    {t.source === "dealer" ? "Dealer inventory" : t.customer.name || "Outside customer"}
                    {t.concern ? ` · ${t.concern.slice(0, 70)}` : ""}
                  </p>
                  <div className="chips">
                    <span className={"chip shop-" + t.status}>{STATUS_LABEL[t.status] || t.status}</span>
                    <span className="chip">
                      {t.source === "dealer"
                        ? `Our cost ${cents(dealerCost(t, settings))}`
                        : r.balance > 0.004
                        ? `Owes ${cents(r.balance)}`
                        : `Total ${cents(r.total)} · paid`}
                    </span>
                  </div>
                </div>
                <div className="row-acts">
                  <button className="mini" onClick={() => onOpen(t)}>
                    Open
                  </button>
                  <button className="mini" onClick={() => setPrintDoc({ ticket: t })}>
                    Print
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {printDoc && (
        <PrintPortal>
          <TicketPrint t={printDoc.ticket} settings={settings} blank={!!printDoc.blank} />
        </PrintPortal>
      )}
    </>
  );
}

/* ---------- ticket form ---------- */
function TicketForm({ initial, tickets, cars, settings, notify, onCancel, onSaved, onDeleted }) {
  const [t, setT] = useState(() => structuredClone(initial));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [printDoc, setPrintDoc] = usePrintDoc();
  const dealer = t.source === "dealer";
  const totals = ticketTotals(t);
  const set = (patch) => setT((x) => ({ ...x, ...patch }));
  const setVeh = (k, v) => setT((x) => ({ ...x, vehicle: { ...x.vehicle, [k]: v } }));
  const setLine = (i, patch) => setT((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const stockCars = useMemo(
    () => [...cars].sort((a, b) => Number(a.sold) - Number(b.sold) || (b.year || 0) - (a.year || 0)),
    [cars]
  );
  const pickCar = (id) => {
    const c = cars.find((x) => x.id === id);
    if (!c) return set({ carId: null });
    set({ carId: c.id, vehicle: { year: String(c.year || ""), make: c.make || "", model: c.model || "", trim: c.trim || "", color: c.color || "", vin: c.vin || "", miles: c.mileage ? String(c.mileage) : "" } });
  };

  const toggleService = (s) => set({ services: t.services.includes(s) ? t.services.filter((x) => x !== s) : [...t.services, s] });

  const save = async () => {
    if (dealer && !t.carId && !t.vehicle.vin) return notify("Pick the inventory car (or enter its VIN) for dealer work.");
    if (!dealer && !t.customer.name.trim()) return notify("Add the customer's name.");
    const lines = t.lines
      .filter((l) => (l.desc || "").trim() || n2(l.unit))
      .map((l) => ({ kind: l.kind, desc: (l.desc || "").trim(), qty: n2(l.qty), unit: n2(l.unit), cost: n2(l.cost) }));
    setBusy(true);
    try {
      const saved = await saveTicket({ ...t, lines, customer: { name: t.customer.name.trim(), phone: t.customer.phone.trim() }, vehicle: { ...t.vehicle, vin: (t.vehicle.vin || "").toUpperCase() } });
      notify(`Ticket ${saved.num} saved.`);
      onSaved(saved);
    } catch (e) {
      notify("Couldn't save the ticket. " + (e && e.message ? e.message : ""));
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!t.id) return;
    if (t.status === "closed") return notify("A closed ticket is a service record and can't be deleted. Mark it Void instead.");
    if (!window.confirm(`Delete ticket ${t.num}? Mark it Void instead if you want to keep a record.`)) return;
    try {
      await deleteTicket(t.id);
      onDeleted(t.id);
    } catch (e) {
      notify("Couldn't delete it. " + (e && e.message ? e.message : ""));
    }
  };

  const attach = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    try {
      for (const f of files) {
        await uploadDocument(f, {
          carId: t.carId || null,
          category: "repair",
          label: `Repair ticket ${t.num}`,
          vin: t.vehicle.vin || "",
          vehicle: vehText(t.vehicle),
        });
      }
      notify(`Attached ${files.length} file${files.length === 1 ? "" : "s"} to ${t.num}${t.carId ? " and the car's file" : ""}.`);
    } catch (err) {
      notify("Couldn't attach that file. " + (err && err.message ? err.message : ""));
    }
    setUploading(false);
  };

  return (
    <div className="form">
      <p className="micro gold">
        Work ticket {t.num} {t.id ? "" : "— new"}
      </p>
      <div className="fields">
        <label>
          <span>Shop</span>
          <select value={t.shop} onChange={(e) => set({ shop: e.target.value })}>
            {settings.shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Date in</span>
          <input type="date" value={t.date} onChange={(e) => set({ date: e.target.value })} />
        </label>
        <label>
          <span>Status</span>
          <select value={t.status} onChange={(e) => set({ status: e.target.value })}>
            {STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Mechanic / tech</span>
          <input value={t.tech} onChange={(e) => set({ tech: e.target.value })} />
        </label>
      </div>

      <div className="shop-source">
        <span className="micro">This car is</span>
        <button className={dealer ? "on" : ""} onClick={() => set({ source: "dealer", taxRate: 0 })}>
          Dealer inventory
        </button>
        <button className={!dealer ? "on" : ""} onClick={() => set({ source: "outside", carId: null, taxRate: t.taxRate || settings.taxRate })}>
          Outside customer
        </button>
        <span className="scan-hint">
          {dealer
            ? "Our own car. The real cost (parts, sublet, mechanic's share) is added to that car's expenses when it sells."
            : "Billed to the customer — this is shop income. Sales tax applies to parts."}
        </span>
      </div>

      <div className="fields">
        {dealer ? (
          <label className="full">
            <span>Inventory car</span>
            <select value={t.carId || ""} onChange={(e) => pickCar(e.target.value)}>
              <option value="">Pick the car…</option>
              {stockCars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.year} {c.make} {c.model} {c.vin ? "· …" + c.vin.slice(-6) : ""} {c.sold ? "(sold)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="full">
              <span>Customer name</span>
              <input value={t.customer.name} onChange={(e) => set({ customer: { ...t.customer, name: e.target.value } })} />
            </label>
            <label className="full">
              <span>Customer phone</span>
              <input type="tel" value={t.customer.phone} onChange={(e) => set({ customer: { ...t.customer, phone: e.target.value } })} />
            </label>
          </>
        )}
        <label>
          <span>Year</span>
          <input value={t.vehicle.year} onChange={(e) => setVeh("year", e.target.value)} inputMode="numeric" />
        </label>
        <label>
          <span>Make</span>
          <input value={t.vehicle.make} onChange={(e) => setVeh("make", e.target.value)} />
        </label>
        <label>
          <span>Model</span>
          <input value={t.vehicle.model} onChange={(e) => setVeh("model", e.target.value)} />
        </label>
        <label>
          <span>Miles in</span>
          <input value={t.vehicle.miles} onChange={(e) => setVeh("miles", e.target.value)} inputMode="numeric" />
        </label>
        <label className="full">
          <span>VIN</span>
          <input value={t.vehicle.vin} onChange={(e) => setVeh("vin", e.target.value.toUpperCase())} maxLength={17} />
        </label>
      </div>

      <div className="cost-section">
        <p className="micro gold">Type of service (these print as tick boxes)</p>
        <div className="shop-services">
          {SERVICE_TYPES.map((s) => (
            <label key={s}>
              <input type="checkbox" checked={t.services.includes(s)} onChange={() => toggleService(s)} /> {s}
            </label>
          ))}
        </div>
        <div className="fields">
          <label className="full">
            <span>Concern / work requested</span>
            <textarea rows={3} value={t.concern} onChange={(e) => set({ concern: e.target.value })} />
          </label>
        </div>
      </div>

      <div className="cost-section">
        <p className="micro gold">Labor, parts &amp; sublet</p>
        <div className="shop-lines">
          {t.lines.map((l, i) => (
            <div className="shop-line" key={i}>
              <select
                value={l.kind}
                onChange={(e) => setLine(i, { kind: e.target.value, ...(e.target.value === "labor" ? { unit: l.unit || settings.laborRate, cost: 0 } : {}) })}
                aria-label="Line type"
              >
                {LINE_KINDS.map(([v, lab]) => (
                  <option key={v} value={v}>
                    {lab}
                  </option>
                ))}
              </select>
              <input
                className="grow"
                value={l.desc}
                onChange={(e) => setLine(i, { desc: e.target.value })}
                placeholder={l.kind === "labor" ? "Work performed" : l.kind === "part" ? "Part name / number" : l.kind === "sublet" ? "Sent out to / work" : "Fee"}
              />
              <input value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} inputMode="decimal" aria-label={l.kind === "labor" ? "Hours" : "Quantity"} title={l.kind === "labor" ? "Hours" : "Qty"} />
              <input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} inputMode="decimal" aria-label="Price each" title={l.kind === "labor" ? "Rate / hr" : "Price each"} />
              {l.kind === "part" || l.kind === "sublet" ? (
                <input value={l.cost} onChange={(e) => setLine(i, { cost: e.target.value })} inputMode="decimal" aria-label="Our cost each" title="Our cost each" />
              ) : (
                <span className="shop-nocost">—</span>
              )}
              <strong className="shop-amt">{cents(n2(l.qty) * n2(l.unit))}</strong>
              <button className="linkish" onClick={() => set({ lines: t.lines.filter((_, j) => j !== i) })} aria-label="Remove line">
                ✕
              </button>
            </div>
          ))}
          <p className="scan-hint">Columns: type · description · hours/qty · rate or price each · our cost each (parts & sublet) · amount</p>
        </div>
        <div className="shop-actions">
          {LINE_KINDS.map(([k, label]) => (
            <button key={k} className="mini" onClick={() => set({ lines: [...t.lines, { kind: k, desc: "", qty: 1, unit: k === "labor" ? settings.laborRate : 0, cost: 0 }] })}>
              + {label}
            </button>
          ))}
        </div>
      </div>

      <div className="shop-summary">
        <div className="fields" style={{ marginTop: 0 }}>
          <label>
            <span>Tax on parts %</span>
            <input value={t.taxRate} onChange={(e) => set({ taxRate: e.target.value })} inputMode="decimal" />
          </label>
          {!dealer && (
            <>
              <label>
                <span>Amount paid</span>
                <input value={t.paidAmount} onChange={(e) => set({ paidAmount: e.target.value })} inputMode="decimal" />
              </label>
              <label>
                <span>Paid via</span>
                <select value={t.paidMethod} onChange={(e) => set({ paidMethod: e.target.value })}>
                  {["", "Cash", "Card", "Check", "Zelle / transfer", "Financing"].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="full">
            <span>Internal notes</span>
            <textarea rows={2} value={t.notes} onChange={(e) => set({ notes: e.target.value })} />
          </label>
        </div>
        <dl className="shop-totals">
          <dt>Labor</dt>
          <dd>{cents(totals.labor)}</dd>
          <dt>Parts</dt>
          <dd>{cents(totals.parts)}</dd>
          {totals.sublet > 0 && (
            <>
              <dt>Sublet</dt>
              <dd>{cents(totals.sublet)}</dd>
            </>
          )}
          {totals.fees > 0 && (
            <>
              <dt>Fees</dt>
              <dd>{cents(totals.fees)}</dd>
            </>
          )}
          <dt>Tax on parts</dt>
          <dd>{cents(totals.tax)}</dd>
          <dt className="big">{dealer ? "Work value" : "Customer total"}</dt>
          <dd className="big">{cents(totals.total)}</dd>
          {!dealer && (
            <>
              <dt>Paid</dt>
              <dd>{cents(totals.paid)}</dd>
              <dt>
                <b>Balance due</b>
              </dt>
              <dd>
                <b>{cents(totals.balance)}</b>
              </dd>
            </>
          )}
          {dealer && (
            <>
              <dt>
                <b>Our real cost</b>
              </dt>
              <dd>
                <b>{cents(dealerCost(t, settings))}</b>
              </dd>
              <dt className="scan-hint">= parts at our cost</dt>
              <dd className="scan-hint">{cents(totals.partsCost)}</dd>
              <dt className="scan-hint">+ sublet at our cost</dt>
              <dd className="scan-hint">{cents(totals.subletCost)}</dd>
              <dt className="scan-hint">+ mechanic's share of labor ({100 - n2((settings.shops.find((x) => x.id === t.shop) || { ourShare: 100 }).ourShare)}%)</dt>
              <dd className="scan-hint">{cents(totals.labor * (1 - n2((settings.shops.find((x) => x.id === t.shop) || { ourShare: 100 }).ourShare) / 100))}</dd>
            </>
          )}
        </dl>
        {dealer && t.lines.some((l) => (l.kind === "part" || l.kind === "sublet") && n2(l.unit) > 0 && !n2(l.cost)) && (
          <p className="scan-hint warn" style={{ gridColumn: "1/-1" }}>
            A part or sublet line has no “our cost each” entered, so it counts as $0 of real cost. Fill in what you actually paid for it.
          </p>
        )}
      </div>

      <div className="cost-section">
        <p className="micro gold">Photo of the filled-in ticket</p>
        {t.id ? (
          <>
            <p className="scan-hint">
              Take a clear, flat photo of the mechanic's signed ticket and attach it here. It is filed with the vehicle's documents
              {t.carId ? " (Vehicle files)" : " under its VIN"} and kept with the rest of the records.
            </p>
            <input type="file" accept="image/*,application/pdf" multiple onChange={attach} disabled={uploading} />
            {uploading && <span className="scan-hint"> Uploading…</span>}
          </>
        ) : (
          <p className="scan-hint">Save the ticket first, then you can attach the photo.</p>
        )}
      </div>

      <div className="shop-actions" style={{ marginTop: 22 }}>
        <button className="btn btn-gold" disabled={busy} onClick={save}>
          {busy ? "Saving…" : t.id ? "Save ticket" : "Open ticket"}
        </button>
        <button className="btn btn-navy" onClick={() => setPrintDoc({ ticket: t })}>
          Print ticket
        </button>
        <button className="linkish" onClick={onCancel}>
          Back
        </button>
        {t.id && (
          <button className="linkish" style={{ marginLeft: "auto" }} onClick={remove}>
            Delete
          </button>
        )}
      </div>
      {t.updatedBy && <p className="scan-hint">Last updated by {t.updatedBy}</p>}

      {printDoc && (
        <PrintPortal>
          <TicketPrint t={printDoc.ticket} settings={settings} />
        </PrintPortal>
      )}
    </div>
  );
}

/* ---------- the printed ticket: big type, heavy lines, room to write ---------- */
export function TicketPrint({ t, settings, blank }) {
  const dealer = t.source === "dealer";
  const r = ticketTotals(t);
  const rows = [...t.lines.filter((l) => (l.desc || "").trim() || n2(l.unit))];
  const spare = Math.max(3, 6 - rows.length);
  const unfilled = blank || !(t.concern || t.vehicle.make || t.customer.name);
  const line = (txt, w) => <span className="wo-fill" style={{ minWidth: w }}>{txt || " "}</span>;
  return (
    <div className="wo">
      <div className="wo-head">
        <div>
          <h1>Capital Auto Sales</h1>
          <p>8607 Oakview Ave, Henrico, VA 23228 · 804-372-4422</p>
          <p className="wo-shop">{shopName(settings, t.shop)}</p>
        </div>
        <div className="wo-num">
          <small>{dealer ? "RECON TICKET — DEALER CAR" : "REPAIR ORDER — CUSTOMER CAR"}</small>
          <strong>{t.num}</strong>
          <span>Date in: {unfilled && !t.id ? "____ / ____ / ______" : dateShort(t.date)}</span>
        </div>
      </div>

      <div className="wo-grid">
        <div className="wo-box">
          <small>{dealer ? "Billed to" : "Customer"}</small>
          <p>{dealer ? "Capital Auto Sales — inventory" : line(t.customer.name, 220)}</p>
          {!dealer && <p>Phone: {line(t.customer.phone, 170)}</p>}
          <div className="wo-tick">
            <span>☐ Dealer car</span>
            <span>☐ Outside</span>
          </div>
        </div>
        <div className="wo-box">
          <small>Vehicle</small>
          <p>
            Year {line(t.vehicle.year, 50)} Make {line(t.vehicle.make, 80)} Model {line((t.vehicle.model || "") + (t.vehicle.trim ? " " + t.vehicle.trim : ""), 80)}
          </p>
          <p>VIN: {line(t.vehicle.vin, 200)} Color: {line(t.vehicle.color, 80)}</p>
          <p>Miles in: {line(t.vehicle.miles, 100)} Mechanic: {line(t.tech, 120)}</p>
        </div>
      </div>

      <div className="wo-box">
        <small>Type of service — tick all that apply</small>
        <div className="wo-services">
          {SERVICE_TYPES.map((s) => (
            <span key={s}>
              {t.services.includes(s) ? "☒" : "☐"} {s}
            </span>
          ))}
        </div>
      </div>

      <div className="wo-box">
        <small>Concern / work requested</small>
        <p className="wo-text">{t.concern}</p>
        <div className="wo-lines">
          <i />
        </div>
      </div>

      <div className="wo-box">
        <small>Mechanic — findings, work done, comments</small>
        <div className="wo-lines tall">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>

      <table className="wo-table">
        <thead>
          <tr>
            <th style={{ width: 70 }}>Type</th>
            <th>Description (labor / parts / sublet)</th>
            <th style={{ width: 62 }}>Hrs/Qty</th>
            <th style={{ width: 80 }}>Rate/Price</th>
            <th style={{ width: 90 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={i}>
              <td>{(LINE_KINDS.find((k) => k[0] === l.kind) || ["", ""])[1]}</td>
              <td>{l.desc}</td>
              <td className="n">{n2(l.qty)}</td>
              <td className="n">{cents(l.unit)}</td>
              <td className="n">{cents(n2(l.qty) * n2(l.unit))}</td>
            </tr>
          ))}
          {Array.from({ length: spare }).map((_, i) => (
            <tr key={"b" + i} className="blank">
              <td className="wo-lps">☐L ☐P ☐S</td>
              <td />
              <td />
              <td />
              <td />
            </tr>
          ))}
        </tbody>
      </table>

      <div className="wo-bottom">
        <div className="wo-box wo-sign">
          <p>Mechanic signature: ______________________ Date: __________</p>
          <p>{dealer ? "Approved by: ______________________" : "Customer approval: ______________________"}</p>
        </div>
        <table className="wo-tot">
          <tbody>
            <tr>
              <td>Labor</td>
              <td className="n">{rows.length ? cents(r.labor) : "$"}</td>
            </tr>
            <tr>
              <td>Parts</td>
              <td className="n">{rows.length ? cents(r.parts) : "$"}</td>
            </tr>
            <tr>
              <td>Tax</td>
              <td className="n">{rows.length ? cents(r.tax) : "$"}</td>
            </tr>
            <tr className="g">
              <td>TOTAL</td>
              <td className="n">{rows.length ? cents(r.total) : "$"}</td>
            </tr>
            {!dealer && (
              <tr>
                <td>Paid</td>
                <td className="n">{t.paidAmount ? cents(r.paid) : "$"}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="wo-foot">When finished, lay this sheet flat in good light, photograph it, and attach the photo to this ticket on the website.</p>
    </div>
  );
}

/* ---------- money in / out ---------- */
function MoneyView({ ledger, setLedger, settings, notify }) {
  const [f, setF] = useState({ kind: "expense", date: todayStr(), shop: settings.shops[0].id, category: EXP_CATS[0], amount: "", method: "Cash", vendor: "", note: "" });
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [fshop, setFshop] = useState("all");
  const upd = (p) => setF((x) => ({ ...x, ...p }));

  const add = async (e) => {
    e.preventDefault();
    const amount = n2(f.amount);
    if (amount <= 0) return notify("Enter an amount.");
    try {
      const saved = await addLedger({ ...f, amount, vendor: f.vendor.trim(), note: f.note.trim() });
      setLedger((l) => [saved, ...l]);
      upd({ amount: "", vendor: "", note: "" });
      notify(f.kind === "income" ? "Income added." : "Spending added.");
    } catch (err) {
      notify("Couldn't save that entry. " + (err && err.message ? err.message : ""));
    }
  };
  const del = async (x) => {
    if (!window.confirm("Delete this entry?")) return;
    try {
      await deleteLedger(x.id);
      setLedger((l) => l.filter((y) => y.id !== x.id));
    } catch (err) {
      notify("Couldn't delete it.");
    }
  };

  const list = ledger.filter((x) => (!month || (x.date || "").startsWith(month)) && (fshop === "all" || x.shop === fshop));
  const inc = list.filter((x) => x.kind === "income").reduce((s, x) => s + x.amount, 0);
  const exp = list.filter((x) => x.kind === "expense").reduce((s, x) => s + x.amount, 0);

  return (
    <>
      <p className="scan-hint" style={{ margin: "10px 0" }}>
        Shop spending and income that isn't on a ticket: bay rent from the rental shop, tools, utilities, payroll. Parts used on a car go on that car's ticket instead, so they aren't counted twice.
      </p>
      <form onSubmit={add}>
        <div className="fields">
          <label>
            <span>Type</span>
            <select
              value={f.kind}
              onChange={(e) => upd({ kind: e.target.value, category: (e.target.value === "income" ? INC_CATS : EXP_CATS)[0] })}
            >
              <option value="expense">Spending</option>
              <option value="income">Income</option>
            </select>
          </label>
          <label>
            <span>Date</span>
            <input type="date" value={f.date} onChange={(e) => upd({ date: e.target.value })} />
          </label>
          <label>
            <span>Shop</span>
            <select value={f.shop} onChange={(e) => upd({ shop: e.target.value })}>
              {settings.shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value="gen">General / dealership</option>
            </select>
          </label>
          <label>
            <span>Category</span>
            <select value={f.category} onChange={(e) => upd({ category: e.target.value })}>
              {(f.kind === "income" ? INC_CATS : EXP_CATS).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Amount ($)</span>
            <input value={f.amount} onChange={(e) => upd({ amount: e.target.value })} inputMode="decimal" />
          </label>
          <label>
            <span>Paid by / via</span>
            <select value={f.method} onChange={(e) => upd({ method: e.target.value })}>
              {["Cash", "Check", "Card", "Zelle / transfer", "Account"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Vendor / payer</span>
            <input value={f.vendor} onChange={(e) => upd({ vendor: e.target.value })} />
          </label>
          <label>
            <span>Note or receipt #</span>
            <input value={f.note} onChange={(e) => upd({ note: e.target.value })} />
          </label>
        </div>
        <div className="shop-actions">
          <button className="btn btn-gold" type="submit">
            Add entry
          </button>
        </div>
      </form>

      <div className="docs-audit-filters" style={{ marginTop: 22 }}>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        <select value={fshop} onChange={(e) => setFshop(e.target.value)} aria-label="Shop">
          <option value="all">All shops</option>
          {settings.shops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value="gen">General / dealership</option>
        </select>
      </div>
      {list.length === 0 ? (
        <p className="scan-hint" style={{ marginTop: 12 }}>Nothing recorded for this selection.</p>
      ) : (
        <div className="shop-scroll">
          <table className="shop-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Shop</th>
                <th>Category</th>
                <th>Vendor / payer</th>
                <th>Note</th>
                <th className="n">In</th>
                <th className="n">Out</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id}>
                  <td>{dateShort(x.date)}</td>
                  <td>{shopName(settings, x.shop)}</td>
                  <td>{x.category}</td>
                  <td>{x.vendor}</td>
                  <td>{x.note}</td>
                  <td className="n">{x.kind === "income" ? cents(x.amount) : ""}</td>
                  <td className="n">{x.kind === "expense" ? cents(x.amount) : ""}</td>
                  <td>
                    <button className="linkish" onClick={() => del(x)} aria-label="Delete entry">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Totals</td>
                <td className="n">{cents(inc)}</td>
                <td className="n">{cents(exp)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------- monthly income ---------- */
const REPORT_COLS = [
  ["oCount", "Outside jobs"],
  ["sales", "Outside sales"],
  ["cost", "Parts + sublet cost"],
  ["mech", "Mechanic split"],
  ["unpaid", "Unpaid"],
  ["dCount", "Dealer jobs"],
  ["dealerBilled", "Dealer work value"],
  ["dealerCost", "Dealer cost"],
  ["income", "Other income"],
  ["spend", "Spending"],
  ["net", "Net to us"],
];

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
const q = (v) => `"${String(v).replace(/"/g, '""')}"`;

function ReportsView({ tickets, ledger, settings }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [period, setPeriod] = useState("month");
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());

  const range = (() => {
    const y = now.getFullYear();
    const m = now.getMonth();
    const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (period === "month") return [ymd(new Date(y, m, 1)), ymd(new Date(y, m + 1, 0))];
    if (period === "last") return [ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))];
    if (period === "year") return [`${y}-01-01`, `${y}-12-31`];
    return [from || "0000-01-01", to || "9999-12-31"];
  })();
  const rep = periodReport(tickets, ledger, settings, range[0], range[1]);
  const months = useMemo(() => monthlyTable(tickets, ledger, settings, year), [tickets, ledger, settings, year]);
  const shopIds = [...settings.shops.map((s) => s.id), "gen"].filter((id) => id !== "gen" || months.some((m) => m.byShop.gen !== undefined));
  const yearTot = months.reduce((s, m) => s + m.rep.tot.net, 0);
  const cell = (k, v) => (k.endsWith("Count") ? v : cents(v));

  const exportCsv = () => {
    const head = ["Month", ...shopIds.map((id) => shopName(settings, id) + " net"), "Outside sales", "Mechanic split", "Dealer cost", "Net to us"];
    const rows = months.map((m) => [m.name + " " + year, ...shopIds.map((id) => (m.byShop[id] || 0).toFixed(2)), m.rep.tot.sales.toFixed(2), m.rep.tot.mech.toFixed(2), m.rep.tot.dealerCost.toFixed(2), m.rep.tot.net.toFixed(2)]);
    download(`shop-monthly-${year}.csv`, [head, ...rows].map((r) => r.map(q).join(",")).join("\r\n"));
  };

  return (
    <>
      <p className="scan-hint" style={{ margin: "10px 0" }}>
        What each shop brought in and spent, month by month. Void tickets are left out. Dated by the ticket's “date in”.
      </p>

      <div className="docs-audit-filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
          {[0, 1, 2, 3].map((i) => (
            <option key={i} value={now.getFullYear() - i}>
              {now.getFullYear() - i}
            </option>
          ))}
        </select>
        <button className="mini" onClick={exportCsv}>
          Export {year} by month (CSV)
        </button>
      </div>
      <div className="shop-scroll">
        <table className="shop-table">
          <thead>
            <tr>
              <th>Month</th>
              {shopIds.map((id) => (
                <th key={id} className="n">
                  {shopName(settings, id)}
                </th>
              ))}
              <th className="n">Outside sales</th>
              <th className="n">Net to us</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month}>
                <td>{m.name}</td>
                {shopIds.map((id) => (
                  <td key={id} className="n">
                    {m.byShop[id] === undefined ? "—" : cents(m.byShop[id])}
                  </td>
                ))}
                <td className="n">{cents(m.rep.tot.sales)}</td>
                <td className="n">
                  <b className={m.rep.tot.net < 0 ? "neg" : ""}>{cents(m.rep.tot.net)}</b>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>{year} total</td>
              {shopIds.map((id) => (
                <td key={id} className="n">
                  {cents(months.reduce((s, m) => s + (m.byShop[id] || 0), 0))}
                </td>
              ))}
              <td className="n">{cents(months.reduce((s, m) => s + m.rep.tot.sales, 0))}</td>
              <td className="n">
                <b className={yearTot < 0 ? "neg" : ""}>{cents(yearTot)}</b>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="micro gold" style={{ marginTop: 28 }}>Detail for a period</p>
      <div className="docs-audit-filters">
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
          <option value="month">This month</option>
          <option value="last">Last month</option>
          <option value="year">This year</option>
          <option value="custom">Custom dates</option>
        </select>
        {period === "custom" && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </>
        )}
      </div>
      <div className="shop-scroll">
        <table className="shop-table">
          <thead>
            <tr>
              <th>Shop</th>
              {REPORT_COLS.map(([, l]) => (
                <th key={l} className="n">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rep.list.map((r) => {
              const s = settings.shops.find((x) => x.id === r.id);
              return (
                <tr key={r.id}>
                  <td>
                    {shopName(settings, r.id)}
                    {s && <div className="scan-hint">{s.arrangement} · we keep {n2(s.ourShare)}% of labor</div>}
                  </td>
                  {REPORT_COLS.map(([k]) => (
                    <td key={k} className={"n" + (k === "net" && r[k] < 0 ? " neg" : "")}>
                      {cell(k, r[k])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>
                All shops · {dateShort(rep.from)}–{dateShort(rep.to)}
              </td>
              {REPORT_COLS.map(([k]) => (
                <td key={k} className="n">
                  {cell(k, rep.tot[k])}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="scan-hint" style={{ marginTop: 10, maxWidth: 780 }}>
        <p><b>Outside sales</b> = labor, parts, sublet and fees billed to outside customers, before sales tax. <b>Mechanic split</b> = the part of labor that goes to the mechanic under that shop's arrangement (Shop setup).</p>
        <p><b>Dealer work</b> is the billed value of work on our own cars — not income. <b>Dealer cost</b> is the real money it took: parts cost, sublet cost and the mechanic's split.</p>
        <p><b>Net to us</b> = outside sales − parts and sublet cost − mechanic split + other income − spending − dealer cost. Sales tax collected this period: <b>{cents(rep.tot.tax)}</b> (owed to Virginia, not income).</p>
      </div>
    </>
  );
}

/* ---------- inventory recon by car ---------- */
function ReconView({ tickets, cars, settings, onOpen }) {
  const [openId, setOpenId] = useState("");
  const openCar = cars.find((c) => c.id === openId);
  if (openCar) return <CarRecon car={openCar} tickets={tickets} settings={settings} onBack={() => setOpenId("")} onOpen={onOpen} />;
  const by = useMemo(() => reconByCar(tickets, settings), [tickets, settings]);
  const rows = Object.entries(by)
    .map(([id, g]) => ({ id, g, car: cars.find((c) => c.id === id) }))
    .sort((a, b) => b.g.cost - a.g.cost);
  const unlinked = tickets.filter((t) => t.source === "dealer" && t.status !== "void" && !t.carId);
  return (
    <>
      <div className="shop-actions" style={{ marginBottom: 6 }}>
        <select value={openId} onChange={(e) => setOpenId(e.target.value)} className="shop-carpick" aria-label="Car">
          <option value="">Open the full cost sheet for a car…</option>
          {[...cars]
            .sort((a, b) => Number(a.sold) - Number(b.sold) || (b.year || 0) - (a.year || 0))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {carLabel(c)}
              </option>
            ))}
        </select>
      </div>
      <p className="scan-hint" style={{ margin: "10px 0" }}>
        All shop work on our own cars, grouped by car, so each car's real reconditioning cost is on record before it's priced or sold. When you start a buyer's order for one of these cars, this cost is added to its expenses so the profit is right.
      </p>
      {rows.length === 0 ? (
        <p className="scan-hint">No inventory work yet. Tickets marked “Dealer inventory” and linked to a car appear here.</p>
      ) : (
        <div className="shop-scroll">
          <table className="shop-table">
            <thead>
              <tr>
                <th>Car</th>
                <th>Tickets</th>
                <th className="n">Work value</th>
                <th className="n">Real cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ id, g, car }) => (
                <tr key={id}>
                  <td>
                    {car ? (
                      <button className="linkish" onClick={() => setOpenId(id)}>
                        {`${car.year} ${car.make} ${car.model}${car.sold ? " (sold)" : ""}`}
                      </button>
                    ) : (
                      "Removed car"
                    )}
                  </td>
                  <td>
                    {g.tickets.map((n) => {
                      const t = tickets.find((x) => x.num === n && x.carId === id);
                      return (
                        <button key={n} className="linkish" style={{ marginRight: 8 }} onClick={() => t && onOpen(t)}>
                          {n}
                        </button>
                      );
                    })}
                  </td>
                  <td className="n">{cents(g.billed)}</td>
                  <td className="n">
                    <b>{cents(g.cost)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unlinked.length > 0 && (
        <p className="scan-hint warn" style={{ marginTop: 12 }}>
          {unlinked.length} dealer ticket{unlinked.length === 1 ? " isn't" : "s aren't"} linked to an inventory car ({unlinked.map((t) => t.num).join(", ")}) — open {unlinked.length === 1 ? "it" : "them"} and pick the car so the cost follows the car.
        </p>
      )}
    </>
  );
}

/* ---------- shop setup ---------- */
function SetupView({ settings, setSettings, notify }) {
  const [s, setS] = useState(() => structuredClone(settings));
  const setShop = (i, p) => setS((x) => ({ ...x, shops: x.shops.map((sh, j) => (j === i ? { ...sh, ...p } : sh)) }));
  const save = async () => {
    const clean = {
      laborRate: n2(s.laborRate),
      taxRate: n2(s.taxRate),
      shops: s.shops.map((sh) => ({ id: sh.id, name: (sh.name || "").trim() || "Shop", arrangement: (sh.arrangement || "").trim(), ourShare: Math.min(100, Math.max(0, n2(sh.ourShare))) })),
    };
    try {
      await saveSettings(clean);
      setSettings(clean);
      notify("Shop setup saved.");
    } catch (e) {
      notify("Couldn't save the setup. " + (e && e.message ? e.message : ""));
    }
  };
  return (
    <>
      <p className="scan-hint" style={{ margin: "10px 0" }}>
        Name each shop and set how its labor is split. “Our share of labor” is the percent of labor the dealership keeps; the rest is paid to the mechanic (0 for the rented shop, 50 for the shared mechanic, 100 for shops we run).
      </p>
      {s.shops.map((sh, i) => (
        <div className="fields" key={sh.id}>
          <label>
            <span>Shop name</span>
            <input value={sh.name} onChange={(e) => setShop(i, { name: e.target.value })} />
          </label>
          <label>
            <span>Arrangement</span>
            <input value={sh.arrangement} onChange={(e) => setShop(i, { arrangement: e.target.value })} />
          </label>
          <label>
            <span>Our share of labor %</span>
            <input value={sh.ourShare} onChange={(e) => setShop(i, { ourShare: e.target.value })} inputMode="numeric" />
          </label>
        </div>
      ))}
      <div className="fields">
        <label>
          <span>Default labor rate ($/hr)</span>
          <input value={s.laborRate} onChange={(e) => setS({ ...s, laborRate: e.target.value })} inputMode="decimal" />
        </label>
        <label>
          <span>Default sales tax on parts %</span>
          <input value={s.taxRate} onChange={(e) => setS({ ...s, taxRate: e.target.value })} inputMode="decimal" />
        </label>
      </div>
      <p className="scan-hint">Changing a shop's labor share also changes how past tickets are split in reports. Set it once and keep it steady.</p>
      <div className="shop-actions">
        <button className="btn btn-gold" onClick={save}>
          Save shop setup
        </button>
      </div>
    </>
  );
}
