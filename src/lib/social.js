const money = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n) || 0);
const miles = (n) => new Intl.NumberFormat("en-US").format(Number(n) || 0);

// The caption for a car on Google, Facebook, Instagram. No phone numbers on
// purpose: Google rejects posts that contain one (its Call button carries the
// number), and Facebook and Instagram have their own call/message buttons.
// The price line is the processing-fee disclosure Va. Code § 46.2-1581(8)
// requires whenever a price is advertised without the fee in it.
export function postText(car, dealer, link) {
  const name = `${car.year} ${car.make} ${car.model}${car.trim ? " " + car.trim : ""}`.trim();
  const fee = Number(dealer.processingFee) > 0 ? ` and a ${money(dealer.processingFee)} dealer processing fee` : "";
  const facts = [`${miles(car.mileage)} miles`, car.condition && `${car.condition} condition`, car.color].filter(Boolean).join(" · ");
  return [
    `${name} — ${money(car.price)}`,
    facts,
    "",
    ...((car.description || "").trim() ? [(car.description || "").trim(), ""] : []),
    `Price excludes tax, title, tags${fee}.`,
    `${dealer.name} · ${dealer.address}, ${dealer.city}`,
    `More photos and details: ${link}`,
  ].join("\n");
}
