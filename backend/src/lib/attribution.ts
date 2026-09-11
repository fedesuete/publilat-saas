// Atribución del ALTA de un cliente de Publi.lat (embudo de venta propio): normaliza los ids del clic
// de Meta que manda el navegador al registrarse. Puro, sin side-effects.

export interface ClickIds {
  fbp: string | null;
  fbc: string | null;
  fbclid: string | null;
}

const clean = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s ? s : null;
};

// fbc: si no vino la cookie _fbc pero sí el fbclid de la URL, se deriva con el formato oficial de Meta
// `fb.1.<ms>.<fbclid>` (mismo criterio que land.ts para los leads de landing externa).
export function clickIdsFromSignup(input: {
  fbp?: string | null;
  fbc?: string | null;
  fbclid?: string | null;
  now?: Date;
}): ClickIds {
  const fbp = clean(input.fbp);
  const fbclid = clean(input.fbclid);
  const fbc = clean(input.fbc) ?? (fbclid ? `fb.1.${(input.now ?? new Date()).getTime()}.${fbclid}` : null);
  return { fbp, fbc, fbclid };
}

// Origen de la cuenta: referida por un cliente, o alta directa desde el panel (app.publi.lat/register).
export function signupSource(input: { referred: boolean }): "referido" | "app" {
  return input.referred ? "referido" : "app";
}
