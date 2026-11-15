// Step 35: the "Report a problem" form. What it sends to POST /api/reports, or what is missing first.
// Pure: tested on its own (web/test/report.test.js).

/** { ok: true, body } to send, or { ok: false, error } to show. */
export function reportProblem({ reason = "", projectId = null, url = "" }) {
  const text = reason.trim();
  if (text.length < 5) return { ok: false, error: "Say what is wrong in a few words." };
  if (text.length > 2000) return { ok: false, error: "Please keep it under 2000 characters." };
  const link = url.trim();
  if (link && !/^https?:\/\/\S+$/.test(link)) return { ok: false, error: "The link must be a web address (http:// or https://)." };
  return { ok: true, body: { reason: text, ...(projectId && { projectId }), ...(link && { url: link }) } };
}
