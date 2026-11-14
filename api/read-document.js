// Reads a photo of a vehicle document (auction invoice, condition report,
// title, state inspection receipt) with an AI vision model and returns the
// vehicle details printed on it. Only called when the dealer clicks "Read
// with AI" because the on-device reading couldn't make sense of the photo —
// the image leaves the device to reach Anthropic or Google only then.
//
// Signed-in dealer/partner only. Tries Claude first (ANTHROPIC_API_KEY), then
// Gemini's free tier (GEMINI_API_KEY), like api/suggest-description.js.

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { requireUser } from "./_lib/auctionShared.js";

const SYSTEM_PROMPT =
  "You read photos of used-car paperwork: auction invoices, condition reports, titles, and Virginia " +
  "state safety inspection receipts. Reply with ONLY a JSON object, no other text, with exactly these " +
  'keys: "vin", "year", "make", "model", "trim", "color", "mileage", "inspection", "inspectionDate". ' +
  "Use null for anything not clearly printed on the document — never guess or fill in from memory. " +
  "vin: copy the 17-character VIN exactly as printed; a VIN never contains the letters I, O or Q. " +
  'year: 4 digits, as a number. mileage: the odometer reading as a number with no commas. ' +
  'color: a plain color name such as "White" (expand abbreviations like WHT). ' +
  'inspection: "passed" if this is a safety inspection receipt that shows approval, "failed" if it shows ' +
  "rejection or failure, otherwise null. inspectionDate: the date the inspection was done, as YYYY-MM-DD.";

const MAX_IMAGES = 3;
const MAX_TOTAL_BYTES = 4_000_000; // Vercel rejects request bodies over ~4.5 MB

function errDetail(e) {
  if (!e) return "unknown error";
  const status = e.status || e.statusCode || (e.response && e.response.status);
  const apiMsg = (e.error && (e.error.message || JSON.stringify(e.error))) || e.message || String(e);
  return status ? `[${status}] ${apiMsg}` : apiMsg;
}

function parseJson(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

async function tryClaude(images) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.mime, data: im.data } })),
          { type: "text", text: "Read this document and reply with the JSON object." },
        ],
      },
    ],
  });
  const block = response.content.find((b) => b.type === "text");
  return block ? parseJson(block.text) : null;
}

async function tryGemini(images) {
  if (!process.env.GEMINI_API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents: [
      {
        role: "user",
        parts: [
          ...images.map((im) => ({ inlineData: { mimeType: im.mime, data: im.data } })),
          { text: "Read this document and reply with the JSON object." },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      maxOutputTokens: 600,
    },
  });
  return parseJson(response.text);
}

const clean = (v, max) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim().slice(0, max));

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const auth = await requireUser(req);
  if (!auth) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
    res.status(200).json({ error: "AI reading isn't set up — add a GEMINI_API_KEY (or ANTHROPIC_API_KEY) in Vercel." });
    return;
  }

  const raw = Array.isArray(req.body && req.body.images) ? req.body.images.slice(0, MAX_IMAGES) : [];
  const images = raw
    .filter((im) => im && /^image\/(jpeg|png|webp)$/.test(im.mime) && typeof im.data === "string" && im.data.length > 100)
    .map((im) => ({ mime: im.mime, data: im.data }));
  if (!images.length) {
    res.status(400).json({ error: "No readable image was sent." });
    return;
  }
  if (images.reduce((n, im) => n + im.data.length, 0) > MAX_TOTAL_BYTES) {
    res.status(413).json({ error: "That image is too large to send." });
    return;
  }

  let result = null;
  let usedFallback = false;
  const errors = [];
  try {
    result = await tryClaude(images);
  } catch (e) {
    errors.push(errDetail(e));
    console.error("read-document: Claude failed —", errDetail(e));
  }
  if (!result) {
    try {
      result = await tryGemini(images);
      usedFallback = true;
    } catch (e) {
      errors.push(errDetail(e));
      console.error("read-document: Gemini failed —", errDetail(e));
    }
  }

  if (!result) {
    res.status(200).json({ error: `Couldn't read that document — ${errors[errors.length - 1] || "no answer from the AI"}` });
    return;
  }

  const year = Number(result.year);
  const mileage = Number(String(result.mileage ?? "").replace(/[^\d.]/g, ""));
  res.status(200).json({
    usedFallback,
    vin: clean(result.vin, 20).toUpperCase().replace(/[^A-Z0-9]/g, ""),
    year: year >= 1950 && year <= 2100 ? String(year) : "",
    make: clean(result.make, 40),
    model: clean(result.model, 40),
    trim: clean(result.trim, 40),
    color: clean(result.color, 30),
    mileage: mileage >= 50 && mileage <= 500000 ? String(Math.round(mileage)) : "",
    inspection: result.inspection === "passed" || result.inspection === "failed" ? result.inspection : "",
    inspectionDate: /^\d{4}-\d{2}-\d{2}$/.test(clean(result.inspectionDate, 10)) ? clean(result.inspectionDate, 10) : "",
  });
}
