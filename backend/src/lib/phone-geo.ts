// País / provincia / ciudad a partir del teléfono, para el user_data del CAPI: son claves de match
// extra que Meta usa además de ph/fbp/fbc (suben el Event Match Quality) y salen gratis del número.
// - País: por el código de país, validando el largo → los IDs internos de WhatsApp (LID, 15 dígitos)
//   no se confunden con teléfonos.
// - Provincia y ciudad: SOLO Argentina, donde el celular conserva la característica de la ciudad
//   donde se sacó la línea. En PY/UY/EC/etc. el prefijo del celular es de la empresa, no de la ciudad.
import { AR_AREAS } from "./ar-areas.js";

export interface PhoneGeo { country?: string; st?: string; ct?: string }

// [patrón sobre los dígitos, código ISO] de los mercados de los clientes (LATAM + España). AR: 54 +
// 9 opcional (celular) + los 10 dígitos del número nacional, que empiezan con la característica
// (1, 2 o 3); el grupo captura esos 10 dígitos.
const PAISES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^549?([123]\d{9})$/, "ar"],
  [/^595\d{8,9}$/, "py"],
  [/^593\d{8,9}$/, "ec"],
  [/^598\d{8}$/, "uy"],
  [/^591\d{8}$/, "bo"],
  [/^55\d{10,11}$/, "br"],
  [/^56\d{9}$/, "cl"],
  [/^51\d{9}$/, "pe"],
  [/^57\d{10}$/, "co"],
  [/^521?\d{10}$/, "mx"],
  [/^58\d{10}$/, "ve"],
  [/^34\d{9}$/, "es"],
];

// Formato que pide Meta para ct/st: minúsculas, sin tildes, sin espacios ni signos. NFD separa la
// tilde de la letra ("í" → "i" + tilde) y el filtro a-z la descarta junto con todo lo demás.
const paraMeta = (s: string) => s.normalize("NFD").toLowerCase().replace(/[^a-z]/g, "");

export function phoneGeo(phone: string | null | undefined): PhoneGeo {
  const digitos = (phone ?? "").replace(/\D/g, "");
  for (const [patron, country] of PAISES) {
    const m = patron.exec(digitos);
    if (m) return country === "ar" ? { country, ...zonaAR(m[1]) } : { country };
  }
  return {};
}

// La tabla usa "54" + los primeros dígitos del número nacional; gana el prefijo más largo porque
// hay sub-zonas dentro de una misma característica (2982 41… Claromecó, 2982 497… Bellocq).
function zonaAR(nacional: string): Pick<PhoneGeo, "st" | "ct"> {
  for (let n = nacional.length; n > 0; n--) {
    const zona = AR_AREAS["54" + nacional.slice(0, n)];
    if (!zona) continue;
    const [ciudad, provincia] = zona;
    return ciudad ? { st: paraMeta(provincia), ct: paraMeta(ciudad) } : { st: paraMeta(provincia) };
  }
  return {};
}
