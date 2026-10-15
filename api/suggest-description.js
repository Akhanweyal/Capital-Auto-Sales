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
  "plain text only (no markdown, no quotes around it, no emoji). Mention the year/make/model/trim, " +
  "mileage, and condition naturally, the way a real listing would, so the page reads well for both " +
  "shoppers and search engines. Don't invent features, history, or condition details that weren't " +
  "given to you. Don't use a salesy opening like 'Introducing' or 'Check out'.";

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
  const ai = new GoogleGenAI({});
  const interaction = await ai.interactions.create({
    model: "gemini-2.5-flash",
    input: `Write a listing description for: ${facts}`,
    system_instruction: SYSTEM_PROMPT,
    generation_config: { max_output_tokens: 400 },
  });
  return interaction.output_text ? interaction.output_text.trim() : null;
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
  try {
    description = await tryClaude(facts);
  } catch (e) {
    // fall through to Gemini
  }
  if (!description) {
    try {
      description = await tryGemini(facts);
      usedFallback = true;
    } catch (e) {
      // both failed
    }
  }

  if (description) {
    res.status(200).json({ description, usedFallback });
  } else {
    res.status(200).json({ error: "Couldn't generate a description. Try again." });
  }
}
