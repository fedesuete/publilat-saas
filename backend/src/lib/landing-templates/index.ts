// Registro central de plantillas server-side. renderTemplate es el ÚNICO camino de render:
// hace fill() (defaults + clamp + escape + color validado) antes de llamar al render de la
// plantilla, así ninguna plantilla puede recibir values sin sanear.
import type { TplCtx, TplDef } from "./types.js";
import { fill } from "./shared.js";
import { casinoBono } from "./casino-bono.js";
import { casinoUrgencia } from "./casino-urgencia.js";
import { casinoVip } from "./casino-vip.js";
import { casinoSimple } from "./casino-simple.js";

export const TEMPLATES: TplDef[] = [casinoBono, casinoUrgencia, casinoVip, casinoSimple];

export const getTemplate = (id: string): TplDef | undefined => TEMPLATES.find((t) => t.id === id);

export function renderTemplate(def: TplDef, ctx: TplCtx): string {
  return def.render({ ...ctx, values: fill(def, ctx.values) });
}
