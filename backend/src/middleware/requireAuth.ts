// Protege rutas /api/*: exige un JWT válido (cookie httpOnly o Bearer) e inyecta req.userId.
import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

export const AUTH_COOKIE = "publilat_token";

// Extiende Request con userId (TS estricto).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// Toma el token de la cookie httpOnly (preferido) o del header Authorization: Bearer.
function extractToken(req: Request): string | null {
  const cookieToken = (req as unknown as { cookies?: Record<string, string> }).cookies?.[AUTH_COOKIE];
  if (cookieToken) return cookieToken;
  const header = req.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme === "Bearer" && token) return token;
  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "No autenticado" });

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: "Token inválido o vencido" });
  }

  // Revocación: si el token trae tv, debe coincidir con el tokenVersion actual del usuario.
  // (Los tokens viejos sin tv siguen valiendo hasta vencer, para no expulsar en masa.)
  if (typeof payload.tv === "number") {
    try {
      const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { tokenVersion: true } });
      if (!user || user.tokenVersion !== payload.tv) {
        return res.status(401).json({ error: "Sesión revocada. Iniciá sesión de nuevo." });
      }
    } catch (e) {
      console.error("[requireAuth] error verificando tokenVersion:", e instanceof Error ? e.message : String(e));
      return res.status(500).json({ error: "Error de autenticación" });
    }
  }

  req.userId = payload.userId;
  return next();
}
