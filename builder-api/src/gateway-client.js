// Talks to the Gateway on Laptop B over Tailscale (ARCHITECTURE.md §5.3). A always calls B, never the reverse.
const GATEWAY_URL = process.env.GATEWAY_URL;
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY;

async function call(method, route, body) {
  if (!GATEWAY_URL || !GATEWAY_API_KEY) throw new Error("GATEWAY_URL/GATEWAY_API_KEY not set in builder-api/.env");
  let res;
  try {
    res = await fetch(`${GATEWAY_URL}${route}`, {
      method,
      headers: { "X-API-Key": GATEWAY_API_KEY, ...(body && { "Content-Type": "application/json" }) },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    // Network-level failures: say what to check instead of "fetch failed".
    if (err.name === "TimeoutError") {
      throw new Error(`Gateway at ${GATEWAY_URL} did not answer within 15 s: is it busy or stuck on Laptop B?`);
    }
    throw new Error(
      `Gateway at ${GATEWAY_URL} is not reachable: is Laptop B on, with the Gateway running (scripts/start-laptop-b.ps1), and Tailscale connected on both laptops?`
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Gateway ${method} ${route}: ${res.status} ${data.error ?? ""}`.trim());
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Same (image, contractHash) twice returns the same Gateway job, so resubmitting is safe. */
export const submitFrontend = ({ imageDataUrl, instructions, contractHash, mode }) =>
  call("POST", "/v1/generations", { image: imageDataUrl, instructions, contractHash, mode, type: "create" });

export const getFrontend = (remoteJobId) => call("GET", `/v1/generations/${remoteJobId}`);
