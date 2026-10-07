/* ---------- Auction purchase document import (PDF/photo -> form fields) ----------
   ACV (and most auction platforms) hand you a condition report / invoice once
   you've won a vehicle — a PDF or a photo of one. Pull the VIN out of it and
   run it through the same NHTSA decode already used for barcode scans, plus a
   best-effort grab at mileage. Everything here runs on-device; nothing is
   uploaded anywhere for this step. */

import { extractVin } from "./vin.js";

async function extractTextFromPdf(file) {
  const [pdfjsLib, workerUrlMod] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrlMod.default;

  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str || "").join(" ") + "\n";
  }
  return text;
}

async function extractTextFromImage(file) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(file);
    return data.text || "";
  } finally {
    await worker.terminate();
  }
}

export function isPdfFile(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

export async function extractTextFromDocument(file) {
  return isPdfFile(file) ? extractTextFromPdf(file) : extractTextFromImage(file);
}

// "Odometer: 45,231 mi", "Mileage 45231", "Miles: 45,231" — ACV-style reports
// put the label right before the number, so this is deliberately narrow
// rather than grabbing the first big number on the page (which just as often
// is a lot number, a price, or a phone number).
const MILES_RE = /\b(?:odometer|mileage|miles?)\b[^\d]{0,12}([\d,]{4,7})\b/i;

export function parseAuctionText(text) {
  const vin = extractVin(text);

  let mileage = "";
  const m = text.match(MILES_RE);
  if (m) {
    const n = Number(m[1].replace(/,/g, ""));
    if (n >= 50 && n <= 500000) mileage = String(n);
  }

  return { vin, mileage };
}
