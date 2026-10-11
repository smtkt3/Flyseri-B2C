/** Extract a budget only when the visitor explicitly describes one; never invent prices. */
export function budgetIntent(message: string): { total: number; adults: number; currency: string } | null {
  const text = message.replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)));
  if (/\b(?:USD|EUR|GBP|MYR|SGD|dollars?|euros?|ringgit)\b|[$€£]/i.test(text)) return null;
  if (!/budget|বাজেট|(?:i|we) (?:have|can spend)|আমার.{0,12}টাকা/i.test(text)) return null;
  const amount = /(?:৳|BDT|budget(?:\s+(?:of|is))?\s*[:=]?|বাজেট\s*[:=]?)\s*([\d,]+(?:\.\d+)?)(k|lakh|লাখ)?/i.exec(text)
    ?? /([\d,]+(?:\.\d+)?)(k|lakh|লাখ)?\s*(?:BDT|taka|টাকা)/i.exec(text);
  if (!amount) return null;
  const total = Number(amount[1]!.replace(/,/g, '')) * (/lakh|লাখ/i.test(amount[2] ?? '') ? 100000 : /k/i.test(amount[2] ?? '') ? 1000 : 1);
  if (!Number.isFinite(total) || total < 1 || total > 999999999) return null;
  const people = /\b([1-9])\s*(?:adults?|people|persons?|travell?ers?|pax)\b|([1-9])\s*জন/i.exec(text);
  const adults = people ? Number(people[1] ?? people[2]) : /two people|two adults|দুইজন|দুই জন/i.test(text) ? 2 : 1;
  return { total, adults, currency: 'BDT' };
}
