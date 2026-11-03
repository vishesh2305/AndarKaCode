// Step 29: before the app, from GET /api/me and the ?signin= the Builder API sends back after a sign-in.
const LABELS = { github: "GitHub", google: "Google" };
const MESSAGES = {
  "not-invited": "This account is not on the invite list yet. Ask for an invite, then sign in again with the same email.",
  "not-verified": "That account has no verified email. Verify your email with the provider, or use another account.",
  failed: "The sign-in did not finish. Please try again.",
};

/** { show: "loading" } | { show: "app", user } | { show: "sign-in", buttons, message }. */
export function signInView(me, search) {
  if (!me) return { show: "loading" };
  if (!me.auth || me.user) return { show: "app", user: me.user };
  const reason = new URLSearchParams(search).get("signin");
  return {
    show: "sign-in",
    buttons: (me.providers ?? []).map((provider) => ({ provider, label: `Sign in with ${LABELS[provider] ?? provider}`, href: `/auth/${provider}/start` })),
    message: MESSAGES[reason] ?? null,
  };
}
