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

// Otsu's method: picks the gray-level threshold that best separates the
// image into two groups (ink vs. everything else) by maximizing the
// variance between them — standard, well-established technique, not a
// guess at a fixed brightness cutoff that would break on different photos.
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

// Vehicle titles are printed on security paper — colored guilloche patterns,
// gradients, watermarks — specifically designed to defeat casual copying.
// That same design defeats plain OCR too, which is why a raw photo of a
// title tends to come back as noise. Converting to grayscale and snapping
// every pixel to pure black/white at an auto-picked threshold suppresses the
// colored background and leaves just the dark text for the OCR engine.
async function preprocessForOcr(file) {
  const img = await loadImage(file);
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  const maxDim = 2200;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const gray = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }
  const threshold = otsuThreshold(gray);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = gray[p] > threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/png")
  );
}

async function extractTextFromImage(file) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    let input = file;
    try {
      input = await preprocessForOcr(file);
    } catch {
      // If preprocessing fails for any reason, fall back to OCR on the
      // original photo rather than failing the whole import.
    }
    const { data } = await worker.recognize(input);
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
