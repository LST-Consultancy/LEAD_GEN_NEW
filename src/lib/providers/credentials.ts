import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
function key() { const value = process.env.PROVIDER_ENCRYPTION_KEY; if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new Error("Set PROVIDER_ENCRYPTION_KEY to 32 random bytes encoded as hex."); return Buffer.from(value, "hex"); }
export function encryptCredential(value: string, workspaceId: string, provider: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv); cipher.setAAD(Buffer.from(`${workspaceId}:${provider}`));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString("base64")).join(".");
}
export function decryptCredential(value: string, workspaceId: string, provider: string) {
  const [iv, tag, ciphertext] = value.split(".").map(v => Buffer.from(v, "base64")); const decipher = createDecipheriv("aes-256-gcm", key(), iv); decipher.setAAD(Buffer.from(`${workspaceId}:${provider}`)); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
