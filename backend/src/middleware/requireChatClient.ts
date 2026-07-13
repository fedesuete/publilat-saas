// Auth del JUGADOR del Chat App (canal aislado, separado del operador). El jugador entra
// passwordless por un link de invitación y recibe un JWT de tipo "client" (30 días) que
// manda como Bearer desde la PWA. NO usa cookie ni tokenVersion, y NO da acceso al panel
// (requireAuth lo rechaza porque no existe un User con id = playerId).
import type { Request, Response, NextFunction } from "express";
import { verifyToken, signToken } from "../lib/auth.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      chatPlayerId?: string; // ChatPlayer.id del jugador autenticado
      accountId?: string;    // cuenta (User.id) dueña del chat
    }
  }
}

// Firma el token del jugador (30 días). userId = playerId a propósito: si por error se usa
// contra requireAuth, falla (no hay User con ese id) — el jugador nunca accede al panel.
export function signChatClientToken(accountId: string, playerId: string): string {
  return signToken({ userId: playerId, type: "client", accountId, playerId }, "30d");
}

function extractBearer(req: Request): string | null {
  const header = req.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme === "Bearer" && token) return token;
  return null;
}

export function requireChatClient(req: Request, res: Response, next: NextFunction) {
  const token = extractBearer(req);
  if (!token) return res.status(401).json({ error: "No autenticado" });
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: "Token inválido o vencido" });
  }
  if (payload.type !== "client" || !payload.accountId || !payload.playerId) {
    return res.status(401).json({ error: "Token no válido para el chat" });
  }
  req.chatPlayerId = payload.playerId;
  req.accountId = payload.accountId;
  return next();
}
