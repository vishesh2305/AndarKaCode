// Step 52a, guardrails: what a person writes (the brief sent with the screenshots, a region fix's note) is
// checked before any AI reads it. Rules only, so the answer is instant, the same every time, and explainable:
// { ok: true } or { ok: false, rule, reason } with the reason in plain words for the person.
// The AI that reads the text later is still not trusted: generated code and pages have their own checks.
import { BRANDS } from "../safety/brands.js";

const MAX = 1000;

const RULES = [
  {
    rule: "injection",
    reason: "This looks like instructions for the AI itself (to ignore its rules or reveal what it was given). Describe what the app should do or look like instead.",
    patterns: [
      /\b(ignore|disregard|forget|override)\b.{0,40}\b(instructions?|rules?|prompts?|guidelines)\b/,
      /\b(system|hidden|original) prompt\b/,
      /\b(developer|god|jailbreak|dan) mode\b|\byou are now\b|\bjailbreak/,
      /\b(reveal|print|show|tell|leak|give)\b.{0,30}\b(api ?keys?|secrets?|tokens?|passwords?|your (instructions|prompt))\b/,
    ],
  },
  {
    rule: "harmful",
    reason: "AndarKaCode doesn't build code that spies on people, steals data or attacks other systems.",
    patterns: [
      /\bkey ?loggers?\b|\bransomware\b|\bbotnet\b|\bbackdoor\b|\breverse shell\b|\bcrypto ?miner\b|\bddos\b|\bmalware\b/,
      /\b(steal|harvest|grab|exfiltrate|capture)\b.{0,30}\b(cookies?|passwords?|credentials?|sessions?|tokens?|logins?|card)/,
      /\bsend\b.{0,30}\b(cookies?|passwords?|credentials?|sessions?|tokens?|keystrokes?)\b.{0,30}\bto\b/,
    ],
  },
  {
    rule: "sensitive-data",
    reason: "Apps built here can't collect card numbers, CVVs, PINs or ID numbers like Aadhaar. Payments will go through a payment provider (a later step), never through the app's own form.",
    patterns: [
      /\b(credit|debit) card\b|\bcard numbers?\b|\bcvv\b|\bcvc\b/,
      /\b(upi|atm|card) pin\b|\bnet ?banking password\b|\bbank password\b/,
      /\baadhaa?r\b|\bpan (card )?numbers?\b|\bsocial security numbers?\b|\bpassport numbers?\b/,
    ],
  },
];

// A brand together with its login or payment screen, asked for as a copy: a phishing clone.
const COPY = /\b(look(s)? (exactly |just )?like|clone|copy|replica|identical|same as|imitate|fake|pretend)\b/;
const FORM = /\b(log ?in|sign ?in|net ?banking|payment|pay screen|checkout|password|otp)\b/;

function phishing(text) {
  if (!COPY.test(text) || !FORM.test(text)) return null;
  const brand = BRANDS.find(([, pattern]) => pattern.test(text));
  return brand && `This asks for a copy of ${brand[0]}'s login or payment screen, which could be used to trick people. Build your own app's sign-in instead.`;
}

/** { ok: true } or { ok: false, rule, reason }. where: what the text is (for logs); max: its length limit. */
export function checkText(text, { where = "text", max = MAX } = {}) {
  const value = String(text ?? "");
  if (value.length > max) return { ok: false, rule: "length", reason: `The ${where} is too long: at most ${max} characters (it has ${value.length}).` };
  const lower = value.toLowerCase().replace(/\s+/g, " ");
  for (const { rule, reason, patterns } of RULES) if (patterns.some((p) => p.test(lower))) return { ok: false, rule, reason };
  const clone = phishing(lower);
  if (clone) return { ok: false, rule: "phishing", reason: clone };
  return { ok: true };
}
