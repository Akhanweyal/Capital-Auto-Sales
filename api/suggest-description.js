// Suggests a used-car listing description — signed-in dealer/partner only,
// since each call spends real money on the Claude API. Requires an
// ANTHROPIC_API_KEY environment variable (console.anthropic.com -> API Keys)
// to be set in this project's deployment environment; there is no fallback
// without it.

import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "./_lib/auctionShared.js";

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

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(200).json({
      error: "Description suggestions aren't set up yet — ask the site owner to add an ANTHROPIC_API_KEY.",
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

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 400,
      system:
        "You write short used-car listing descriptions for a dealership website. 2-4 sentences, " +
        "plain text only (no markdown, no quotes around it, no emoji). Mention the year/make/model/trim, " +
        "mileage, and condition naturally, the way a real listing would, so the page reads well for both " +
        "shoppers and search engines. Don't invent features, history, or condition details that weren't " +
        "given to you. Don't use a salesy opening like 'Introducing' or 'Check out'.",
      messages: [{ role: "user", content: `Write a listing description for: ${facts}` }],
    });
    const text = response.content.find((b) => b.type === "text");
    res.status(200).json({ description: text ? text.text.trim() : "" });
  } catch (e) {
    res.status(200).json({ error: "Couldn't generate a description. Try again." });
  }
}
