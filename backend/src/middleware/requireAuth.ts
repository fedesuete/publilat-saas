// Protege rutas /api/*: exige un Bearer token válido e inyecta req.userId.
import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth.js";

// Extiende Request con userId (TS estricto).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "No autenticado" });
  }

  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    return next();
  } catch {
    return res.status(401).json({ error: "Token inválido o vencido" });
  }
}
