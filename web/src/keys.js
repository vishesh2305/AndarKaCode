// Step 31b: what each slot can be set to: every saved key, with each listed model of its provider for
// that slot (shared/models.mjs, sent by GET /api/keys). value = "<keyId>|<model>".
export function slotChoices(models, keys, slot) {
  return keys.flatMap((key) =>
    models
      .filter((m) => m.provider === key.provider && m.slots.includes(slot))
      .map((m) => ({
        value: `${key.id}|${m.model}`,
        label: `${key.label || key.provider} (…${key.lastFour}): ${m.model}, ${m.verified ? "verified" : "not yet verified"}`,
      }))
  );
}
