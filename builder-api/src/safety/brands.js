// Step 35: does a set of screenshots look like a phishing clone? A famous brand's name (a bank, a payment
// service, a big sign-in) together with a login or payment form, anywhere in the same app, is flagged; the
// project is then held for a person to review (safety/review.js). A brand alone (an expenses app that lists
// Amazon orders) or a login alone (an app's own sign-in) is ordinary, and so is "Sign in with Google".
// Only what the screen shows as its own words is searched: titles, form labels, buttons, roles; not the
// rows of a table.

// Most specific first: the text a brand matched is taken out before the next one is looked for, so
// "Google Pay" is Google Pay, not Google too.
export const BRANDS = [
  ["Google Pay", /\bgoogle pay\b|\bgpay\b/],
  ["Amazon Pay", /\bamazon pay\b/],
  ["Apple", /\bapple (id|account|pay)\b|\bicloud\b/],
  ["HDFC Bank", /\bhdfc\b/],
  ["ICICI Bank", /\bicici\b/],
  ["State Bank of India", /\bsbi\b|\bstate bank of india\b/],
  ["Axis Bank", /\baxis bank\b/],
  ["Kotak Mahindra Bank", /\bkotak\b/],
  ["Punjab National Bank", /\bpnb\b|\bpunjab national bank\b/],
  ["Bank of Baroda", /\bbank of baroda\b/],
  ["Canara Bank", /\bcanara bank\b/],
  ["Yes Bank", /\byes bank\b/],
  ["IndusInd Bank", /\bindusind\b/],
  ["Union Bank of India", /\bunion bank of india\b/],
  ["Chase", /\bjp ?morgan\b|\bchase (bank|online)\b/],
  ["Wells Fargo", /\bwells fargo\b/],
  ["Bank of America", /\bbank of america\b/],
  ["Citibank", /\bciti(bank)?\b/],
  ["HSBC", /\bhsbc\b/],
  ["Barclays", /\bbarclays\b/],
  ["Santander", /\bsantander\b/],
  ["Capital One", /\bcapital one\b/],
  ["PayPal", /\bpaypal\b/],
  ["Paytm", /\bpaytm\b/],
  ["PhonePe", /\bphonepe\b/],
  ["BHIM", /\bbhim\b/],
  ["Razorpay", /\brazorpay\b/],
  ["Stripe", /\bstripe\b/],
  ["Visa", /\bvisa\b/],
  ["Mastercard", /\bmastercard\b/],
  ["American Express", /\bamerican express\b|\bamex\b/],
  ["Coinbase", /\bcoinbase\b/],
  ["Binance", /\bbinance\b/],
  ["Google", /\bgoogle\b|\bgmail\b/],
  ["Microsoft", /\bmicrosoft\b|\boutlook\b|\boffice ?365\b/],
  ["Amazon", /\bamazon\b/],
  ["Facebook", /\bfacebook\b/],
  ["Instagram", /\binstagram\b/],
  ["WhatsApp", /\bwhatsapp\b/],
  ["Netflix", /\bnetflix\b/],
  ["LinkedIn", /\blinkedin\b/],
  ["Yahoo", /\byahoo\b/],
  ["Dropbox", /\bdropbox\b/],
  ["DocuSign", /\bdocusign\b/],
  ["Adobe", /\badobe\b/],
  ["Flipkart", /\bflipkart\b/],
  ["Aadhaar", /\baadhaa?r\b|\buidai\b/],
  ["Income Tax Department", /\bincome tax (department|e-?filing)\b/],
  ["EPFO", /\bepfo\b/],
  ["IRCTC", /\birctc\b/],
  ["DigiLocker", /\bdigilocker\b/],
];

// "Sign in with Google", "Continue with Microsoft": an app's own login offering another sign-in.
const OAUTH = /\b(?:(?:sign|log)\s*(?:in|up)|login|continue)\s+(?:with|using|via)\s+[\w ]{2,20}/gi;
const PAYMENT_FIELD = /card\s*(number|no\b)|\bcvv\b|\bcvc\b|\bexpir(y|ation)\b|\bupi\s*pin\b|\bm?pin\b|net\s*banking|\bifsc\b|account\s*number|\botp\b/i;

// The screen's own words (not table rows).
function wordsOf(screen) {
  const forms = screen.forms ?? [];
  return [
    screen.title,
    ...forms.flatMap((f) => [f.submitLabel, ...(f.inputs ?? []).map((i) => i.label)]),
    ...(screen.buttons ?? []).map((b) => b.label),
    ...(screen.auth?.roleIndicators ?? []),
  ]
    .filter((t) => typeof t === "string")
    .join(" \n ")
    .replace(OAUTH, " ")
    .toLowerCase();
}

function formsOn(screen) {
  const inputs = (screen.forms ?? []).flatMap((f) => f.inputs ?? []);
  const payment = inputs.some((i) => PAYMENT_FIELD.test(i.label ?? ""));
  const login = !payment && (screen.kind === "login" || screen.auth?.loginForm === true || inputs.some((i) => i.kind === "password"));
  return [...(login ? ["login"] : []), ...(payment ? ["payment"] : [])];
}

/** [{ brand, form: "login"|"payment", screenshot (of the form, 1-based), reason }] for a project's readings. */
export function flagsOf(inventories) {
  const brands = [];
  const forms = new Map(); // form -> first screenshot with it
  inventories.forEach((screen, i) => {
    if (!screen) return;
    let text = wordsOf(screen);
    for (const [name, pattern] of BRANDS) {
      if (!pattern.test(text)) continue;
      if (!brands.includes(name)) brands.push(name);
      text = text.replace(new RegExp(pattern.source, "g"), " ");
    }
    for (const form of formsOn(screen)) if (!forms.has(form)) forms.set(form, i + 1);
  });
  return brands.flatMap((brand) =>
    [...forms].map(([form, screenshot]) => ({ brand, form, screenshot, reason: `${brand} together with a ${form} form (screenshot ${screenshot})` }))
  );
}
