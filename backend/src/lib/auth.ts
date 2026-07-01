// Helpers de autenticación: hash de password (bcrypt) y JWT.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_EXPIRES_IN = "7d";

// El secreto se lee en el momento de usarlo (no al importar) para no romper imports
// en tests/tooling. El chequeo de arranque vive en validateEnv().
function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("Falta JWT_SECRET en .env");
  return s;
}

export interface JwtPayload {
  userId: string;
  tv?: number; // tokenVersion: para revocar sesiones (si no coincide con el de la DB -> inválido)
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);

export const verifyPassword = (plain: string, hash: string) =>
  bcrypt.compare(plain, hash);

export const signToken = (payload: JwtPayload) =>
  jwt.sign(payload, secret(), { expiresIn: JWT_EXPIRES_IN });

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, secret()) as JwtPayload;
}

// Convierte un texto a slug url-safe (para User.slug en /go?u=<slug>).
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // saca acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
