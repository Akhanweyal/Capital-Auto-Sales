/* ---------- Vehicle document reading (PDF/photo -> form fields) ----------
   Auction invoices, condition reports, titles and state inspection receipts
   all carry the VIN, and usually the mileage, a date, and sometimes the
   year/make/model/color. A PDF with real text is read exactly. A photo is
   read on the device with OCR (nothing is uploaded); because OCR on a phone
   photo of a receipt is unreliable, several light variations of the photo
   are read and every VIN found is checked against the government VIN
   database before it is believed. */

import { vinCandidates, decodeVin } from "./vin.js";

/* ---------- loading ---------- */
async function loadImage(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to the <img> path below
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pdfDocument(file) {
  const [pdfjsLib, workerUrlMod] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrlMod.default;
  return pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
}

async function pdfPageCanvas(doc, n, scale) {
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas;
}

function isPdfFile(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

/* ---------- image preparation ---------- */
function fitCanvas(img, maxDim) {
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function grayOf(canvas) {
  const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  const g = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return g;
}

function canvasFromGray(g, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  for (let p = 0, i = 0; p < g.length; p++, i += 4) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = g[p];
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Stretch the 2nd–98th percentile of brightness to the full range, so a dim
// or washed-out receipt photo has real contrast.
function stretch(g) {
  const hist = new Array(256).fill(0);
  for (const v of g) hist[v]++;
  let lo = 0;
  let hi = 255;
  for (let s = 0; lo < 255; lo++) {
    s += hist[lo];
    if (s > g.length * 0.02) break;
  }
  for (let s = 0; hi > 0; hi--) {
    s += hist[hi];
    if (s > g.length * 0.02) break;
  }
  const span = Math.max(1, hi - lo);
  const out = new Uint8ClampedArray(g.length);
  for (let i = 0; i < g.length; i++) out[i] = Math.max(0, Math.min(255, ((g[i] - lo) * 255) / span));
  return out;
}

function blurred(c, px) {
  const o = document.createElement("canvas");
  o.width = c.width;
  o.height = c.height;
  const x = o.getContext("2d");
  if ("filter" in x) {
    x.filter = `blur(${px}px)`;
    x.drawImage(c, 0, 0);
  } else {
    // Safari has no canvas filter: shrinking and re-enlarging smooths the same way.
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.round(c.width / 2));
    small.height = Math.max(1, Math.round(c.height / 2));
    small.getContext("2d").drawImage(c, 0, 0, small.width, small.height);
    x.drawImage(small, 0, 0, c.width, c.height);
  }
  return o;
}

const stretched = (c) => canvasFromGray(stretch(grayOf(c)), c.width, c.height);

// Otsu's method: the gray level that best separates ink from paper.
function otsuThreshold(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

// Vehicle titles are printed on security paper whose patterns defeat plain
// OCR; snapping to pure black/white leaves just the dark text. It hurts on
// grainy photos, which is why it is only one of several passes.
function blackAndWhite(c) {
  const g = grayOf(c);
  const t = otsuThreshold(g);
  return canvasFromGray(g.map((v) => (v > t ? 255 : 0)), c.width, c.height);
}

const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";

// Measured on degraded receipt photos: a light blur plus contrast stretch,
// with no black-and-white step, recovered the most VINs; the plain photo and
// a sparse-text read limited to VIN characters each caught some the others
// missed. Slower variations (large upscales, adaptive thresholds) took
// 10+ seconds each and were left out.
const PASSES = [
  { name: "blurred", prep: (c) => stretched(blurred(c, 1)), psm: "3", chars: "" },
  { name: "photo", prep: (c) => c, psm: "3", chars: "" },
  { name: "contrast", prep: (c) => stretched(c), psm: "3", chars: "" },
  { name: "black-and-white", prep: (c) => blackAndWhite(c), psm: "3", chars: "" },
  { name: "VIN characters", prep: (c) => stretched(c), psm: "11", chars: VIN_CHARS },
];

async function ocrTexts(canvases, onProgress) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  const texts = [];
  try {
    let step = 0;
    const total = canvases.length * PASSES.length;
    for (const canvas of canvases) {
      for (const pass of PASSES) {
        step++;
        if (onProgress) onProgress(`Reading the photo (${step} of ${total})…`);
        try {
          await worker.setParameters({ tessedit_pageseg_mode: pass.psm, tessedit_char_whitelist: pass.chars });
          const { data } = await worker.recognize(pass.prep(canvas));
          texts.push(data.text || "");
        } catch {
          // One failed variation shouldn't lose the others.
        }
      }
    }
  } finally {
    await worker.terminate();
  }
  return texts;
}

/* ---------- parsing ---------- */
// "Odometer: 45,231 mi", "Mileage 45231" — the label sits right before the
// number, so this is deliberately narrow rather than grabbing the first big
// number on the page (a lot number, a price, a phone number).
const MILES_RE = /\b(?:odometer|odom|mileage|miles?)\b[^\d]{0,24}([\d,]{4,7})\b/i;
const MILES_AFTER_RE = /\b(\d{1,3},\d{3}|\d{4,6})\s*(?:mi\b|miles\b)/i;

function mileageIn(text) {
  const m = text.match(MILES_RE) || text.match(MILES_AFTER_RE);
  if (!m) return "";
  const n = Number(m[1].replace(/,/g, ""));
  return n >= 50 && n <= 500000 ? String(n) : "";
}

const pad = (n) => String(n).padStart(2, "0");

// The most recent date on the page that isn't in the future or over a year
// old — on an inspection receipt that's the inspection date, not the
// sticker's expiry (future).
function recentDate(text) {
  const now = Date.now();
  let best = null;
  for (const m of text.matchAll(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4}|\d{2})\b/g)) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(year, Number(m[1]) - 1, Number(m[2]));
    if (d.getMonth() !== Number(m[1]) - 1) continue;
    const age = now - d.getTime();
    if (age < 0 || age > 370 * 86400000) continue;
    if (!best || d > best) best = d;
  }
  return best ? `${best.getFullYear()}-${pad(best.getMonth() + 1)}-${pad(best.getDate())}` : "";
}

const COLOR_ABBR = {
  WHT: "White", WH: "White", WHITE: "White",
  BLK: "Black", BK: "Black", BLACK: "Black",
  SIL: "Silver", SLV: "Silver", SILVER: "Silver",
  GRY: "Gray", GRAY: "Gray", GREY: "Gray", GY: "Gray",
  BLU: "Blue", BLUE: "Blue", RED: "Red",
  GRN: "Green", GREEN: "Green", TAN: "Tan",
  GLD: "Gold", GOLD: "Gold", BRN: "Brown", BROWN: "Brown",
  ORG: "Orange", ORANGE: "Orange", YEL: "Yellow", YELLOW: "Yellow",
  BGE: "Beige", BEIGE: "Beige", BUR: "Burgundy", MAR: "Maroon", MAROON: "Maroon",
};

// A make read off a photo is only believed if it is a real one — OCR turns
// "FORD" into "F0RD" and "HONDA" into "H0NDA".
const KNOWN_MAKES = new Set(
  (
    "ACURA ALFA ROMEO AUDI BENTLEY BMW BUICK CADILLAC CHEVROLET CHEVY CHRYSLER DODGE FIAT FORD GENESIS GMC HONDA " +
    "HUMMER HYUNDAI INFINITI ISUZU JAGUAR JEEP KIA LAND ROVER LEXUS LINCOLN MAZDA MERCEDES MERCURY MINI " +
    "MITSUBISHI NISSAN OLDSMOBILE PLYMOUTH PONTIAC PORSCHE RAM SAAB SATURN SCION SMART SUBARU SUZUKI TESLA " +
    "TOYOTA VOLKSWAGEN VW VOLVO"
  ).split(" ")
);

// Fields some documents print with a label ("COLOR: WHT"). Only used when
// the VIN lookup can't supply them; the lookup is the better source.
function labelledFields(text) {
  const out = {};
  const year = text.match(/\b(?:model\s+)?year\b[^\dA-Za-z]{0,4}((?:19|20)\d{2})\b/i);
  if (year && Number(year[1]) >= 1981 && Number(year[1]) <= new Date().getFullYear() + 1) out.year = year[1];
  const make = text.match(/\bmake\b[^A-Za-z0-9\n]{0,4}([A-Za-z][A-Za-z\-]{2,19})\b/i);
  if (make && KNOWN_MAKES.has(make[1].toUpperCase())) out.make = make[1].toUpperCase();
  const model = text.match(/\bmodel\b(?!\s*year)[^A-Za-z0-9\n]{0,4}([A-Za-z0-9][A-Za-z0-9\-]{1,19})\b/i);
  if (model && !/^(year|make|vin|color|colour)$/i.test(model[1])) out.model = model[1];
  const color = text.match(/\bcolou?r\b[^A-Za-z0-9\n]{0,4}([A-Za-z]{2,12})\b/i);
  if (color) out.color = COLOR_ABBR[color[1].toUpperCase()] || "";
  return out;
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values.filter(Boolean)) counts.set(v, (counts.get(v) || 0) + 1);
  let best = "";
  let n = 0;
  for (const [v, k] of counts) if (k > n) [best, n] = [v, k];
  return best;
}

// Narrow on purpose: a repair invoice that says "inspected brakes" is not a
// state inspection receipt.
const INSPECTION_RE = /safety\s+inspection|inspection\s+(?:station|sticker|certificate|receipt|report)|approval\s+sticker/i;

function summarize(texts) {
  const all = texts.join("\n");
  return {
    isInspection: INSPECTION_RE.test(all),
    // A rejection receipt is an inspection document too, and must never
    // count as a pass.
    rejected: /reject|fail/i.test(all),
    date: mostCommon(texts.map(recentDate)),
    mileage: mostCommon(texts.map(mileageIn)),
    fields: labelledFields(all),
  };
}

/* ---------- the whole read ---------- */
// Finds the first candidate that the VIN database recognizes as a complete,
// real vehicle. `trusted` is true when it decoded cleanly.
async function verifyVin(candidates) {
  let weak = null;
  for (const vin of candidates.slice(0, 4)) {
    try {
      const vehicle = await decodeVin(vin);
      if (vehicle.clean) return { vin, vehicle, trusted: true };
      if (!weak) weak = { vin, vehicle, trusted: false };
    } catch {
      // Not found / lookup unreachable — try the next candidate.
    }
  }
  return weak;
}

/* ---------- AI reading (only when the dealer asks for it) ---------- */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function jpegBase64(canvas) {
  // The server rejects a request body over ~4.5 MB, so keep each page small.
  for (const quality of [0.82, 0.68, 0.5]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    const data = await blobToBase64(blob);
    if (data.length <= 1_300_000) return data;
  }
  return blobToBase64(await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.4)));
}

// The pictures to send: the photo itself, or the first pages of a PDF.
export async function imagesForAI(file) {
  const canvases = [];
  if (isPdfFile(file)) {
    const doc = await pdfDocument(file);
    for (let i = 1; i <= Math.min(doc.numPages, 2); i++) canvases.push(await pdfPageCanvas(doc, i, 1.6));
  } else {
    canvases.push(fitCanvas(await loadImage(file), 1600));
  }
  const images = [];
  for (const c of canvases) images.push({ mime: "image/jpeg", data: await jpegBase64(c) });
  return images;
}

// Turns the AI's answer into the same shape the on-device reading produces.
// The AI copied the VIN from a picture, so it still has to pass the check
// digit; it does not also have to decode cleanly, because the AI read the
// printed characters directly and older vehicles are often missing from the
// lookup. The vehicle details it printed are used when the lookup has none.
export async function interpretAIReading(data) {
  const info = {
    source: "ai",
    text: "",
    isInspection: !!data.inspection,
    inspection: data.inspection || "",
    rejected: data.inspection === "failed",
    date: data.inspectionDate || "",
    mileage: data.mileage || "",
    fields: { year: data.year, make: data.make, model: data.model, trim: data.trim, color: data.color },
  };
  const vin = String(data.vin || "").toUpperCase();
  const valid = vinCandidates(vin).find((c) => c === vin.replace(/[OQ]/g, "0").replace(/I/g, "1"));
  if (valid) {
    info.vin = valid;
    try {
      const vehicle = await decodeVin(valid);
      if (vehicle.clean) {
        info.vehicle = vehicle;
        info.vinTrusted = true;
      }
    } catch {
      // Not in the lookup (or it didn't answer) — keep the AI's printed details.
    }
  } else if (vin) {
    info.vinRejected = vin;
  }
  return info;
}

// Result: {
//   source: "pdf" | "photo",
//   vin, vehicle, vinTrusted,      // vin only when it passed the checksum
//   vinRejected,                   // a VIN that was read but isn't a real vehicle
//   lookupFailed,                  // the VIN lookup service didn't answer
//   mileage, date, isInspection, rejected, fields, text
// }
export async function readVehicleDocument(file, { onProgress } = {}) {
  let texts = [];
  let source = "photo";

  if (isPdfFile(file)) {
    const doc = await pdfDocument(file);
    let text = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      text += content.items.map((it) => it.str || "").join(" ") + "\n";
    }
    if (text.replace(/\s/g, "").length >= 40) {
      texts = [text];
      source = "pdf";
    } else {
      // A scanned PDF is pictures of pages — read the first few as photos.
      const canvases = [];
      for (let i = 1; i <= Math.min(doc.numPages, 2); i++) canvases.push(await pdfPageCanvas(doc, i, 2));
      texts = await ocrTexts(canvases, onProgress);
    }
  } else {
    const img = await loadImage(file);
    texts = await ocrTexts([fitCanvas(img, 1600)], onProgress);
  }

  const all = texts.join("\n");
  const info = { source, text: all.replace(/\s+/g, " ").trim(), ...summarize(texts) };

  // Rank VIN candidates by how many separate reads agree on them.
  const votes = new Map();
  for (const t of texts) for (const v of vinCandidates(t)) votes.set(v, (votes.get(v) || 0) + 1);
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);

  if (ranked.length) {
    if (onProgress) onProgress("Looking up the VIN…");
    const hit = await verifyVin(ranked);
    if (hit && (hit.trusted || source === "pdf")) {
      Object.assign(info, { vin: hit.vin, vehicle: hit.vehicle, vinTrusted: hit.trusted });
    } else if (!hit && source === "pdf") {
      // Text read straight from a PDF is exact, so keep the VIN even when
      // the lookup has nothing on it (or can't be reached).
      Object.assign(info, { vin: ranked[0], vinTrusted: false, lookupFailed: true });
    } else {
      info.vinRejected = ranked[0];
    }
  }
  return info;
}

