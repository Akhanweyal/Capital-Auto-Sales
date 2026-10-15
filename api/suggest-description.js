// Suggests a used-car listing description — signed-in dealer/partner only,
// since each call spends real money (or free-tier quota) on an AI API.
//
// Tries Claude first (ANTHROPIC_API_KEY, console.anthropic.com -> API Keys),
// and falls back to Gemini's free tier (GEMINI_API_KEY, aistudio.google.com)
// if Claude fails for any reason — out of credits, rate-limited, API outage,
// whichever. Set either or both; only ANTHROPIC_API_KEY alone or
// GEMINI_API_KEY alone both still work, just without the fallback.

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { requireUser } from "./_lib/auctionShared.js";

const SYSTEM_PROMPT =
  "You write short used-car listing descriptions for a dealership website. 2-4 sentences, " +
  "plain text only (no markdown, no quotes around it, no emoji). Work the year, make, model, trim, " +
  "mileage, condition, and city/location naturally into the sentences — the way a real listing " +
  "reads, not a list of specs and not keyword-stuffed — since those are the exact terms shoppers " +
  "type into Google ('used 2018 honda accord for sale in henrico va'), and it has to read well for " +
  "a person first. Don't repeat the same term more than once just to pack it in. Don't invent " +
  "features, history, or condition details that weren't given to you. Don't use a salesy opening " +
  "like 'Introducing' or 'Check out'.";

// Free-tier keys hit real rate/quota limits in normal use (unlike a paid
// Claude key), so it's worth telling the admin *why* it failed rather than
// a flat "try again" — "you're rate-limited, wait a bit" is a different fix
// than "the key is wrong".
function isQuotaError(e) {
  const status = e && (e.status || e.statusCode);
  if (status === 429) return true;
  const msg = (e && e.message) || "";
  return /quota|rate.?limit|resource_exhausted/i.test(msg);
}

// Pulls the most useful bit out of an SDK error for logging/display — the
// status code plus whatever message the API actually sent back, not just
// "Error" or a generic wrapper message.
function errDetail(e) {
  if (!e) return "unknown error";
  const status = e.status || e.statusCode || (e.response && e.response.status);
  const apiMsg =
    (e.error && (e.error.message || JSON.stringify(e.error))) ||
    (e.response && e.response.data && JSON.stringify(e.response.data)) ||
    e.message ||
    String(e);
  return status ? `[${status}] ${apiMsg}` : apiMsg;
}

async function tryClaude(facts) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Write a listing description for: ${facts}` }],
  });
  const text = response.content.find((b) => b.type === "text");
  return text ? text.text.trim() : null;
}

async function tryGemini(facts) {
  if (!process.env.GEMINI_API_KEY) return null;
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents: `Write a listing description for: ${facts}`,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      maxOutputTokens: 400,
    },
  });
  return response.text ? response.text.trim() : null;
}

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
    res.status(200).json({
      error: "Description suggestions aren't set up yet — ask the site owner to add an ANTHROPIC_API_KEY or GEMINI_API_KEY.",
    });
    return;
  }

  const { year, make, model, trim, mileage, condition, city } = req.body || {};
  if (!year || !make || !model) {
    res.status(400).json({ error: "Need at least year, make, and model." });
    return;
  }

  const facts = [
    `${year} ${make} ${model}${trim ? " " + trim : ""}`,
    mileage ? `${Number(mileage).toLocaleString()} miles` : null,
    condition ? `condition: ${condition}` : null,
    city ? `located in ${city}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  let description = null;
  let usedFallback = false;
  let claudeError = null;
  let geminiError = null;
  try {
    description = await tryClaude(facts);
  } catch (e) {
    claudeError = e;
    console.error("suggest-description: Claude failed —", errDetail(e));
  }
  if (!description) {
    try {
      description = await tryGemini(facts);
      usedFallback = true;
    } catch (e) {
      geminiError = e;
      console.error("suggest-description: Gemini failed —", errDetail(e));
    }
  }

  if (description) {
    res.status(200).json({ description, usedFallback });
    return;
  }

  if (geminiError && isQuotaError(geminiError)) {
    res.status(200).json({
      error: claudeError
        ? "Claude failed and Gemini's free tier is rate-limited right now — wait a minute and try again."
        : "Gemini's free tier is rate-limited right now — wait a minute and try again.",
    });
    return;
  }

  // Surface the real error directly rather than a flat "try again" — this
  // is an admin-only internal tool, so there's no reason to hide it behind
  // a generic message the way a customer-facing error would.
  const detail = geminiError ? errDetail(geminiError) : claudeError ? errDetail(claudeError) : "no provider configured";
  res.status(200).json({ error: `Couldn't generate a description — ${detail}` });
}
