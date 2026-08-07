// Auth del JUGADOR del Chat App (canal aislado, separado del operador). El jugador entra
// passwordless por un link de invitación y recibe un JWT de tipo "client" (90 días) que llega
// por Bearer (localStorage de la PWA) O por una cookie httpOnly de larga duración (sobrevive al
// borrado del localStorage — clave para que el jugador no pierda la sesión y NO se le duplique la
// cuenta de ganamos). NO usa tokenVersion, y NO da acceso al panel (requireAuth lo rechaza porque
// no existe un User con id = playerId).
import type { Request, Response, NextFunction } from "express";
import { verifyToken, signToken } from "../lib/auth.js";

// Cookie httpOnly con el token del jugador (se setea en /register, /login, /start, /direct, /session).
export const CHAT_CLIENT_COOKIE = "publilat_chat_token";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      chatPlayerId?: string; // ChatPlayer.id del jugador autenticado
      accountId?: string;    // cuenta (User.id) dueña del chat
    }
  }
}

// Firma el token del jugador (90 días). userId = playerId a propósito: si por error se usa
// contra requireAuth, falla (no hay User con ese id) — el jugador nunca accede al panel.
export function signChatClientToken(accountId: string, playerId: string): string {
  return signToken({ userId: playerId, type: "client", accountId, playerId }, "90d");
}

// Token del jugador: primero Bearer (localStorage), y si no, la cookie httpOnly (sesión persistente).
export function extractChatClientToken(req: Request): string | null {
  const header = req.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme === "Bearer" && token) return token;
  const cookieToken = (req as unknown as { cookies?: Record<string, string> }).cookies?.[CHAT_CLIENT_COOKIE];
  return cookieToken || null;
}

export function requireChatClient(req: Request, res: Response, next: NextFunction) {
  const token = extractChatClientToken(req);
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
