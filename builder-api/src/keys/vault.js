// Step 31b: the key vault. A user's AI key is sealed with AES-256-GCM under KEY_VAULT_SECRET, with its
// workspace and its own id as additional data: a sealed key copied to another workspace or another row,
// changed, or read with another secret does not open. The plain key exists only in memory, for a call.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const boundTo = ({ workspaceId, keyId }) => Buffer.from(`${workspaceId}|${keyId}`);

export function createVault(secretHex) {
  if (!/^[0-9a-f]{64}$/i.test(String(secretHex ?? ""))) throw new Error("KEY_VAULT_SECRET must be 64 hex characters (32 bytes)");
  const secret = Buffer.from(secretHex, "hex");
  return {
    /** { ciphertext, iv, tag }, all base64. */
    seal(plain, at) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", secret, iv).setAAD(boundTo(at));
      const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
    },
    /** The plain key; throws if anything about it is not as sealed. */
    open({ ciphertext, iv, tag }, at) {
      const decipher = createDecipheriv("aes-256-gcm", secret, Buffer.from(iv, "base64")).setAAD(boundTo(at));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
    },
  };
}

/** What may be shown of a key. */
export const lastFour = (key) => String(key).slice(-4);
