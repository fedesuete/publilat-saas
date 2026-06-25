// Exige rol ADMIN. Debe ir DESPUÉS de requireAuth (usa req.userId). 403 si no es admin.
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.userId) return res.status(401).json({ error: "No autenticado" });
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { role: true },
  });
  if (!user || user.role !== "ADMIN") {
    return res.status(403).json({ error: "Acceso denegado" });
  }
  return next();
}
