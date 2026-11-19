import React, { useState, useEffect } from "react";
import { PrintPortal, usePrintDoc } from "./App.jsx";
import { fetchCarCost, upsertCarCost } from "./lib/db.js";
import { STATUS_LABEL, n2, dealerCost, ticketTotals } from "./lib/shop.js";

/* One car's full cost sheet: every shop ticket on it plus cleaning, paint and any
   other expense, added into one repair & recon cost that prints on one sheet.
   The extra expenses are stored in the car's own "Cost & expenses" (car_costs), so
   the profit on its buyer's order already counts them — nothing is counted twice. */

const EXTRA_KINDS = ["Cleaning / detail", "Paint", "Body work", "Towing / transport", "Parts bought", "Inspection / registration", "Other"];
const cents = (n) => "$" + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateShort = (s) => {
  if (!s) return "";
  const [y, m, d] = String(s).split("-");
  return `${m}/${d}/${String(y).slice(2)}`;
};
const todayStr = () => {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
};
const shopName = (settings, id) => (settings.shops.find((s) => s.id === id) || {}).name || "Shop";
export const carLabel = (c) => `${c.year} ${c.make} ${c.model}${c.trim ? " " + c.trim : ""}${c.vin ? " · " + c.vin : ""}${c.sold ? " (sold)" : c.published ? "" : " (draft)"}`;

// Internal only (screen, never on the printed sheet): how a ticket's cost is made up.
function breakdown(t, settings) {
  const r = ticketTotals(t);
  const share = n2((settings.shops.find((x) => x.id === t.shop) || { ourShare: 100 }).ourShare);
  const parts = [];
  if (r.partsCost) parts.push("parts " + cents(r.partsCost));
  if (r.subletCost) parts.push("sublet " + cents(r.subletCost));
  if (share < 100 && r.labor) parts.push("mechanic's labor share " + cents(r.labor * (1 - share / 100)));
  const missing = t.lines.some((l) => (l.kind === "part" || l.kind === "sublet") && n2(l.unit) > 0 && !n2(l.cost));
  return (parts.join(" + ") || "no cost counted") + (missing ? " — a part has no “our cost each” entered on the ticket" : "");
}

export default function CarRecon({ car, tickets, settings, onBack, onOpen }) {
  const [cost, setCost] = useState(0);
  const [extras, setExtras] = useState(null);
  const [kind, setKind] = useState(EXTRA_KINDS[0]);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [printDoc, setPrintDoc] = usePrintDoc();

  useEffect(() => {
    let live = true;
    fetchCarCost(car.id)
      .then((c) => {
        if (!live) return;
        setCost(c ? c.cost || 0 : 0);
        setExtras(c && Array.isArray(c.expenses) ? c.expenses : []);
      })
      .catch(() => {
        if (!live) return;
        setExtras([]);
        setMsg("Couldn't load this car's other expenses.");
      });
    return () => {
      live = false;
    };
  }, [car.id]);

  const mine = tickets
    .filter((t) => t.source === "dealer" && t.carId === car.id && t.status !== "void")
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const ticketCost = mine.reduce((s, t) => s + dealerCost(t, settings), 0);
  const extraCost = (extras || []).reduce((s, x) => s + n2(x.amount), 0);
  const total = ticketCost + extraCost;
  const openOnes = mine.filter((t) => t.status !== "closed");
  const work = (t) => t.lines.map((l) => l.desc).filter(Boolean).join("; ") || t.concern;

  const saveExtras = async (next) => {
    setBusy(true);
    setMsg("");
    try {
      await upsertCarCost(car.id, { cost, expenses: next });
      setExtras(next);
      return true;
    } catch (e) {
      setMsg("Couldn't save that. " + (e && e.message ? e.message : ""));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    const amt = n2(amount);
    if (amt <= 0) return setMsg("Enter the amount.");
    const label = note.trim() ? `${kind} — ${note.trim()}` : kind;
    if (await saveExtras([...(extras || []), { label, amount: amt }])) {
      setNote("");
      setAmount("");
    }
  };
  const del = async (i) => {
    if (!window.confirm("Remove this expense?")) return;
    await saveExtras(extras.filter((_, j) => j !== i));
  };

  return (
    <>
      <div className="shop-actions">
        <button className="linkish" onClick={onBack}>
          ← All cars
        </button>
      </div>
      <p className="micro gold" style={{ marginTop: 10 }}>
        Cost sheet — {carLabel(car)}
      </p>
      <p className="scan-hint">
        Every shop ticket on this car plus cleaning, paint and any other expense, added into one repair &amp; recon cost. The extra expenses are the same ones on the car's own “Cost &amp; expenses”, so the profit on its buyer's order already counts them.
      </p>
      {openOnes.length > 0 && (
        <p className="scan-hint warn">
          {openOnes.length} ticket{openOnes.length === 1 ? " is" : "s are"} not closed yet ({openOnes.map((t) => t.num).join(", ")}) — close {openOnes.length === 1 ? "it" : "them"} before the final print.
        </p>
      )}

      <div className="shop-scroll">
        <table className="shop-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Ticket / shop</th>
              <th>Work</th>
              <th className="n">Our cost</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((t) => (
              <tr key={t.id}>
                <td>{dateShort(t.date)}</td>
                <td>
                  <button className="linkish" onClick={() => onOpen(t)}>
                    {t.num}
                  </button>
                  <div className="scan-hint">
                    {shopName(settings, t.shop)} · {STATUS_LABEL[t.status]}
                  </div>
                </td>
                <td>
                  {work(t)}
                  <div className="scan-hint">{breakdown(t, settings)}</div>
                </td>
                <td className="n">{cents(dealerCost(t, settings))}</td>
              </tr>
            ))}
            {(extras || []).map((x, i) => (
              <tr key={"x" + i}>
                <td />
                <td>Other expense</td>
                <td>{x.label}</td>
                <td className="n">
                  {cents(x.amount)}{" "}
                  <button className="linkish" onClick={() => del(i)} aria-label="Remove expense" disabled={busy}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {mine.length === 0 && (extras || []).length === 0 && (
              <tr>
                <td colSpan={4} className="scan-hint">
                  {extras === null ? "Loading…" : "Nothing on this car yet."}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>Total repair &amp; recon cost</td>
              <td className="n">{cents(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {n2(cost) > 0 && (
        <p className="scan-hint">
          Bought for {cents(cost)} → total invested in this car: <b>{cents(n2(cost) + total)}</b>
        </p>
      )}

      <div className="cost-section">
        <p className="micro gold">Add another expense on this car</p>
        <div className="fields">
          <label>
            <span>Type</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {EXTRA_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className="full">
            <span>Details (who / what)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. full interior detail, rear bumper repaint" />
          </label>
          <label>
            <span>Amount ($)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </label>
        </div>
        <div className="shop-actions">
          <button className="btn btn-gold" onClick={add} disabled={busy || extras === null}>
            Add expense
          </button>
          <button className="btn btn-navy" onClick={() => setPrintDoc(true)}>
            Print cost sheet
          </button>
        </div>
        {msg && <p className="scan-hint warn">{msg}</p>}
      </div>

      {printDoc && (
        <PrintPortal>
          <div className="wo">
            <div className="wo-head">
              <div>
                <h1>Capital Auto Sales</h1>
                <p>8607 Oakview Ave, Henrico, VA 23228 · 804-372-4422</p>
              </div>
              <div className="wo-num">
                <small>REPAIR &amp; RECON COST SHEET</small>
                <span>Printed {todayStr()}</span>
              </div>
            </div>
            <div className="wo-box">
              <small>Vehicle</small>
              <p>
                <b>
                  {car.year} {car.make} {car.model} {car.trim}
                </b>
                {car.color ? " · " + car.color : ""}
                {car.mileage ? " · " + Number(car.mileage).toLocaleString() + " miles" : ""}
              </p>
              <p>VIN: {car.vin || "—"}</p>
            </div>
            <table className="wo-table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Date</th>
                  <th style={{ width: 150 }}>Ticket / shop</th>
                  <th>Work done</th>
                  <th style={{ width: 90 }}>Our cost</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((t) => (
                  <tr key={t.id}>
                    <td>{dateShort(t.date)}</td>
                    <td>
                      {t.num} · {shopName(settings, t.shop)}
                    </td>
                    <td>{work(t)}</td>
                    <td className="n">{cents(dealerCost(t, settings))}</td>
                  </tr>
                ))}
                {(extras || []).map((x, i) => (
                  <tr key={"p" + i}>
                    <td />
                    <td>Other expense</td>
                    <td>{x.label}</td>
                    <td className="n">{cents(x.amount)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} style={{ fontWeight: 700, fontSize: "13pt" }}>
                    TOTAL REPAIR &amp; RECON COST
                  </td>
                  <td className="n" style={{ fontWeight: 700, fontSize: "13pt" }}>
                    {cents(total)}
                  </td>
                </tr>
                {n2(cost) > 0 && (
                  <tr>
                    <td colSpan={3}>Purchase cost {cents(cost)} — total invested in this car</td>
                    <td className="n">
                      <b>{cents(n2(cost) + total)}</b>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {openOnes.length > 0 && <p className="wo-foot">Tickets not yet closed: {openOnes.map((t) => t.num).join(", ")}</p>}
          </div>
        </PrintPortal>
      )}
    </>
  );
}
