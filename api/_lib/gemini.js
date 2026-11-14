// Shared by the endpoints that call Gemini. Google's free models are
// sometimes overloaded (503) or rate-limited (429) for a few minutes at a
// time, and that is per model — so when one model refuses, try the next
// current one instead of failing the dealer's request. A failure that isn't
// about availability (bad key, bad request) is thrown straight away, since
// another model would fail the same way.
//
// `accept(response)` lets the caller reject an answer that came back but is
// unusable (e.g. the model wrote out its reasoning instead of the answer);
// that also moves on to the next model.
//
// File names starting with "_" are excluded from Vercel's API routing.

import { GoogleGenAI } from "@google/genai";

// Stable models listed on Google's models page (checked Nov 2026), newest first.
export const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"];

const SWITCH_STATUSES = new Set([404, 429, 500, 502, 503, 504]);

export function isBusyError(e) {
  const status = e && (e.status || e.statusCode);
  return SWITCH_STATUSES.has(status) || /UNAVAILABLE|high demand|overloaded|RESOURCE_EXHAUSTED/i.test((e && e.message) || "");
}

export async function geminiGenerate(params, client, accept) {
  const ai = client || new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  let lastError;
  for (const model of GEMINI_MODELS) {
    try {
      const response = await ai.models.generateContent({ ...params, model });
      if (!accept || accept(response)) return response;
      lastError = Object.assign(new Error(`${model} gave an unusable answer`), { unusable: true });
      console.error(`gemini: ${model} gave an unusable answer, trying the next model`);
    } catch (e) {
      lastError = e;
      if (!isBusyError(e)) throw e;
      console.error(`gemini: ${model} unavailable, trying the next model —`, (e && e.status) || "", String((e && e.message) || "").slice(0, 120));
    }
  }
  throw lastError;
}
