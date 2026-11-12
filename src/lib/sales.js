/* ---------- buyer's order settlement math ---------- */
// Tolerates "$14,500.00" as typed — a bare Number() turns that into 0.
export const num = (v) => Number(String(v ?? "").replace(/[$,\s]/g, "")) || 0;

// Va. Code § 58.1-2402: 4.15% of the sale price, $75 minimum. "Sale price"
// (§ 58.1-2401) is the full price including accessories and the processing
// fee, "without any allowance or deduction for trade-ins" — so this takes
// the cash price, never the after-trade difference.
export const VA_VEHICLE_TAX_RATE = 0.0415;
export function calcVaTax(salePrice) {
  const t = num(salePrice) * VA_VEHICLE_TAX_RATE;
  return Math.round(Math.max(t, 75) * 100) / 100;
}

// A dealer-sold service contract covering parts and labor is taxed under the
// retail sales tax (23VAC10-210-910), not the motor vehicle tax above: half
// the price, at the local retail rate — 6% in Henrico.
export const SERVICE_CONTRACT_TAX_RATE = 0.06;

export function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function lineTotal(rows) {
  return (rows || []).reduce((sum, r) => sum + num(r.amount), 0);
}

export function saleTotals(s) {
  const cashPrice = num(s.vehicle_price) + num(s.accessories) + num(s.processing_fee);
  const netTradeAllowance = num(s.gross_trade_allowance) - num(s.trade_payoff);
  const subtotal = cashPrice - netTradeAllowance;
  const otherChargesTotal = lineTotal(s.other_charges);
  const serviceContractTax =
    Math.round((num(s.service_contract_amount) / 2) * SERVICE_CONTRACT_TAX_RATE * 100) / 100;
  const taxesFeesTotal =
    num(s.sales_tax) +
    num(s.license_fee) +
    num(s.title_fee) +
    num(s.registration_fee) +
    num(s.highway_use_fee) +
    num(s.dealer_biz_tax) +
    num(s.online_filing_fee) +
    num(s.uninsured_motor_vehicle_fee) +
    num(s.service_contract_amount) +
    serviceContractTax +
    otherChargesTotal;
  const totalDue = subtotal + taxesFeesTotal;
  const totalPrice = cashPrice + taxesFeesTotal;
  const totalCredit = num(s.deposit) + num(s.down_payment);
  const balanceDue = totalDue - totalCredit;
  const expensesTotal = lineTotal(s.car_expenses);
  const netProfit = num(s.vehicle_price) + num(s.processing_fee) - num(s.car_cost) - expensesTotal;

  return {
    cashPrice,
    netTradeAllowance,
    subtotal,
    otherChargesTotal,
    serviceContractTax,
    taxesFeesTotal,
    totalDue,
    totalPrice,
    totalCredit,
    balanceDue,
    expensesTotal,
    netProfit,
  };
}

export const BLANK_SALE = {
  car_id: null,
  sale_date: "",
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
    garaged: "",
    deliveryDate: "",
    stateInspectionNo: "",
    modifications: "",
    transferTagNo: "",
    tempTagNo: "",
  },
  buyer: {
    name: "",
    address: "",
    city: "",
    state: "VA",
    zip: "",
    email: "",
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
    fuelType: "",
    titleNo: "",
    balanceOwedTo: "",
    balanceOwed: "",
    accountNo: "",
    additionalLiens: "",
    allowance: "",
    goodThrough: "",
    quotedBy: "",
  },
  insurance: { company: "", policy: "", agent: "", contact: "", phone: "", expDate: "" },
  lien_holder: { company: "", street: "", cityStateZip: "" },
  remarks: "",
  salesperson: "",
  vehicle_price: "",
  accessories: "",
  service_contract_amount: "",
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
  uninsured_motor_vehicle_fee: 0,
  warranty_type: "as_is",
  warranty_systems: "",
  warranty_duration: "",
  warranty_pct_labor: 0,
  warranty_pct_parts: 0,
  buyers_guide_signed: false,
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
