// Config pública (sin auth) que necesita el frontend antes de loguearse: hoy, el id del pixel de
// marketing de Publi.lat para el pixel del navegador en /login y /register. Nunca expone tokens.
import { Router } from "express";
import { publicMarketingConfig } from "../lib/marketing-capi.js";

export const publicConfigRouter = Router();

publicConfigRouter.get("/", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json(publicMarketingConfig());
});
