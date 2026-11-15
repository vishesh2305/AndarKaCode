// Step 35: trust & safety. A screenshot set that puts a famous brand's name together with a login or payment
// form looks like a phishing clone (a bank's login page, a payment page): the project is held for a person to
// review before anything is built. A brand alone, or a login alone, is ordinary.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flagsOf } from "../src/safety/brands.js";

const screen = (overrides = {}) => ({
  title: "",
  kind: "list",
  tables: [],
  forms: [],
  buttons: [],
  search: false,
  filters: [],
  pagination: false,
  statCards: [],
  auth: { loginForm: false, signupLink: false, userMenu: false, roleIndicators: [] },
  ...overrides,
});
const input = (label, kind = "text") => ({ label, kind, required: true });
const loginScreen = (title, extra = {}) =>
  screen({ title, kind: "login", forms: [{ inputs: [input("Customer ID"), input("Password", "password")], submitLabel: "Login" }], auth: { loginForm: true, signupLink: false, userMenu: false, roleIndicators: [] }, ...extra });

describe("flagsOf: a famous brand together with a login or payment form", () => {
  it("a bank's login page is flagged, naming the brand, the form and the screenshot", () => {
    const flags = flagsOf([loginScreen("HDFC Bank NetBanking")]);
    assert.equal(flags.length, 1);
    assert.deepEqual({ brand: flags[0].brand, form: flags[0].form, screenshot: flags[0].screenshot }, { brand: "HDFC Bank", form: "login", screenshot: 1 });
    assert.match(flags[0].reason, /HDFC Bank.*login/);
  });

  it("a payment form under a brand is flagged (card number, CVV, UPI PIN...)", () => {
    const pay = screen({ title: "PayPal Checkout", kind: "form", forms: [{ inputs: [input("Card number"), input("Expiry date"), input("CVV", "password")], submitLabel: "Pay now" }] });
    assert.deepEqual(flagsOf([pay]).map((f) => [f.brand, f.form]), [["PayPal", "payment"]]);
    const upi = screen({ title: "Pay with PhonePe", kind: "form", forms: [{ inputs: [input("UPI PIN", "password")], submitLabel: "Pay" }] });
    assert.deepEqual(flagsOf([upi]).map((f) => [f.brand, f.form]), [["PhonePe", "payment"]]);
  });

  it("the brand on one screenshot and the login on another still counts (one app)", () => {
    const flags = flagsOf([screen({ title: "Google Account", kind: "dashboard" }), loginScreen("Sign in")]);
    assert.deepEqual(flags.map((f) => [f.brand, f.form]), [["Google", "login"]]);
  });

  it("a brand is found in labels and buttons too, whatever the case, as a whole word", () => {
    assert.equal(flagsOf([loginScreen("Welcome", { buttons: [{ label: "Log in to icici bank" }] })])[0].brand, "ICICI Bank");
    assert.deepEqual(flagsOf([loginScreen("Visage Spa members")]), [], "\"Visa\" inside another word is not Visa");
  });

  it("an ordinary app is not flagged: a login of its own, or a brand without any login or payment", () => {
    assert.deepEqual(flagsOf([loginScreen("Acme HR"), screen({ title: "Employees" })]), []);
    assert.deepEqual(flagsOf([screen({ title: "Orders from Amazon", tables: [{ columns: [{ label: "Amazon order id" }] }] })]), []);
  });

  it("\"Sign in with Google\" on an app's own login page is not a clone of Google's", () => {
    assert.deepEqual(flagsOf([loginScreen("Acme CRM", { buttons: [{ label: "Sign in with Google" }, { label: "Continue with Microsoft" }] })]), []);
  });
});
