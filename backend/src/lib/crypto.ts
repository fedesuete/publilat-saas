// Cifrado de secretos en reposo (tokens de CAPI por usuario). AES-256-GCM.
// La clave sale de APP_ENCRYPTION_KEY (.env). Si se pierde la clave, los tokens
// guardados NO se pueden descifrar -> respaldala junto con el resto del .env.
import crypto from "node:crypto";

const PREFIX = "enc:v1:";

// Deriva una clave de 32 bytes desde APP_ENCRYPTION_KEY (acepta cualquier string).
function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (raw) return crypto.createHash("sha256").update(raw).digest();
  // Dev sin clave: fallback con aviso (en producción validateEnv lo exige).
  if (process.env.NODE_ENV !== "production") {
    return crypto.createHash("sha256").update("publilat-dev-insecure-key").digest();
  }
  throw new Error("Falta APP_ENCRYPTION_KEY en .env");
}

// Cifra texto plano -> "enc:v1:<iv>:<tag>:<cipher>" (todo base64).
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

// Descifra. Si el valor no está cifrado (legado/plano), lo devuelve tal cual.
export function decryptSecret(value: string): string {
  if (!value?.startsWith(PREFIX)) return value;
  const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return dec.toString("utf8");
}

// Devuelve "••••1234" a partir del texto plano (para mostrar en la UI sin exponerlo).
export function maskSecret(plain: string): string {
  const last4 = plain.slice(-4);
  return `••••${last4}`;
}
