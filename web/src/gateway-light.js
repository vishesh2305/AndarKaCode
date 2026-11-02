// Laptop B's light in the header. Screenshot-to-Code only has to be running when it is the Gateway's
// page builder; the single call (the default since Step 23b) needs only the model.
export function gatewayLight(gw) {
  if (!gw) return { ok: null, detail: "checking…" };
  if (!gw.reachable) return { ok: false, detail: `Not reachable: ${gw.error ?? "is the Gateway running?"}` };
  const s2c = (gw.pageBuilder ?? "s2c") === "s2c"; // an older Gateway has no pageBuilder: it uses S2C
  const pages = s2c ? `Screenshot-to-Code ${gw.s2cUp ? "up" : "down"}` : "Pages: one model call";
  return {
    ok: Boolean(gw.ollamaUp && (!s2c || gw.s2cUp)),
    detail: `${pages}, GPU model ${gw.ollamaUp ? "up" : "down"}, ${gw.queueLength ?? 0} job(s) waiting`,
  };
}
