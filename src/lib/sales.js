/* ---------- buyer's order settlement math ---------- */
const num = (v) => Number(v) || 0;

export function calcVaTax(subtotal) {
  const t = num(subtotal) * 0.0415;
  return Math.round(Math.max(t, 75) * 100) / 100;
}

export function lineTotal(rows) {
  return (rows || []).reduce((sum, r) => sum + num(r.amount), 0);
}

export function saleTotals(s) {
  const cashPrice = num(s.vehicle_price) + num(s.processing_fee);
  const netTradeAllowance = num(s.gross_trade_allowance) - num(s.trade_payoff);
  const subtotal = cashPrice - netTradeAllowance;
  const otherChargesTotal = lineTotal(s.other_charges);
  const taxesFeesTotal =
    num(s.sales_tax) +
    num(s.license_fee) +
    num(s.title_fee) +
    num(s.registration_fee) +
    num(s.highway_use_fee) +
    num(s.dealer_biz_tax) +
    num(s.online_filing_fee) +
    otherChargesTotal;
  const totalDue = subtotal + taxesFeesTotal;
  const totalCredit = num(s.deposit) + num(s.down_payment);
  const balanceDue = totalDue - totalCredit;
  const expensesTotal = lineTotal(s.car_expenses);
  const netProfit = num(s.vehicle_price) + num(s.processing_fee) - num(s.car_cost) - expensesTotal;

  return {
    cashPrice,
    netTradeAllowance,
    subtotal,
    otherChargesTotal,
    taxesFeesTotal,
    totalDue,
    totalCredit,
    balanceDue,
    expensesTotal,
    netProfit,
  };
}

export const BLANK_SALE = {
  car_id: null,
  sale_date: new Date().toISOString().slice(0, 10),
  stock_number: "",
  vehicle: {
    newUsed: "Used",
    year: "",
    make: "",
    model: "",
    trim: "",
    body: "",
    color1: "",
    color2: "",
    style: "",
    cyl: "",
    vin: "",
    mileage: "",
    trans: "",
  },
  buyer: {
    name: "",
    address: "",
    city: "",
    state: "VA",
    zip: "",
    homePhone: "",
    cellPhone: "",
    workPhone: "",
    dlNumber: "",
    dlState: "VA",
    dob: "",
    county: "",
    dlExp: "",
  },
  co_buyer_name: "",
  trade_in: {
    year: "",
    make: "",
    model: "",
    body: "",
    vin: "",
    color: "",
    mileage: "",
    balanceOwedTo: "",
    balanceOwed: "",
    allowance: "",
    goodThrough: "",
    quotedBy: "",
  },
  insurance: { company: "", policy: "", agent: "", phone: "" },
  lien_holder: { company: "", street: "", cityStateZip: "" },
  remarks: "",
  salesperson: "",
  vehicle_price: "",
  processing_fee: "",
  gross_trade_allowance: "",
  trade_payoff: "",
  sales_tax: 0,
  license_fee: 0,
  title_fee: 15,
  registration_fee: 30.75,
  highway_use_fee: 0,
  dealer_biz_tax: 0,
  online_filing_fee: 0,
  other_charges: [],
  deposit: "",
  down_payment: "",
  payment_type: "cash",
  car_cost: 0,
  car_expenses: [],
  finalized: false,
};

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function salesToCsv(sales) {
  const header = [
    "Date",
    "Stock #",
    "Buyer",
    "Vehicle",
    "VIN",
    "Vehicle Price",
    "Processing Fee",
    "Trade Allowance (net)",
    "Subtotal",
    "Sales Tax",
    "Other Taxes & Fees",
    "Total Due",
    "Deposit",
    "Down Payment",
    "Balance Due",
    "Payment Type",
    "Car Cost",
    "Car Expenses",
    "Net Profit",
    "Finalized",
  ];

  const rows = sales.map((s) => {
    const t = saleTotals(s);
    const v = s.vehicle || {};
    const vehicleLabel = `${v.year || ""} ${v.make || ""} ${v.model || ""}${v.trim ? " " + v.trim : ""}`.trim();
    const otherTaxesFees = t.taxesFeesTotal - Number(s.sales_tax || 0);
    return [
      s.sale_date,
      s.stock_number || "",
      (s.buyer && s.buyer.name) || "",
      vehicleLabel,
      v.vin || "",
      Number(s.vehicle_price || 0).toFixed(2),
      Number(s.processing_fee || 0).toFixed(2),
      t.netTradeAllowance.toFixed(2),
      t.subtotal.toFixed(2),
      Number(s.sales_tax || 0).toFixed(2),
      otherTaxesFees.toFixed(2),
      t.totalDue.toFixed(2),
      Number(s.deposit || 0).toFixed(2),
      Number(s.down_payment || 0).toFixed(2),
      t.balanceDue.toFixed(2),
      s.payment_type || "",
      Number(s.car_cost || 0).toFixed(2),
      t.expensesTotal.toFixed(2),
      t.netProfit.toFixed(2),
      s.finalized ? "Yes" : "No",
    ];
  });

  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}
