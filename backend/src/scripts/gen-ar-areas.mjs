// Regenera src/lib/ar-areas.ts (características de Argentina → [ciudad, provincia]) desde Google
// libphonenumber. Uso, parado en backend/:
//   curl -sO https://raw.githubusercontent.com/google/libphonenumber/master/resources/geocoding/es/54.txt
//   node src/scripts/gen-ar-areas.mjs 54.txt
import { readFileSync, writeFileSync } from "node:fs";

// Retoques a mano sobre el original (clave → [ciudad, provincia]).
const FIX = {
  "541": ["Buenos Aires", "Buenos Aires"], // viene sin provincia
  "5435417": ["Cosquín", "Córdoba"], // viene "Cosquin/Córdoba" (sin coma ni tilde)
  "543404": ["San Carlos Centro", "Santa Fe"], // viene "Dpto. Las Colonias"; la cabecera del original aclara la ciudad
  "543869": ["", "Tucumán"], // "Ranchillos y San Miguel": dos localidades → solo provincia
};

const filas = [];
for (const linea of readFileSync(process.argv[2], "utf8").split(/\r?\n/)) {
  const m = /^(54\d+)\|(.+)$/.exec(linea);
  if (!m) continue;
  const [, clave, etiqueta] = m;
  let ciudad, provincia;
  if (FIX[clave]) {
    [ciudad, provincia] = FIX[clave];
  } else {
    const i = etiqueta.lastIndexOf(", ");
    if (i < 0) throw new Error(`sin provincia: ${linea}`);
    ciudad = etiqueta.slice(0, i).replace(/\s*\(.*?\)\s*/g, " ").trim();
    provincia = etiqueta.slice(i + 2).trim();
    // Abarca dos provincias ("Cruz Alta, Córdoba/San José de la Esquina, Santa Fe"): sin fila → solo país.
    if (ciudad.includes(", ")) continue;
    if (ciudad.includes("/")) ciudad = ""; // varias localidades → solo provincia
  }
  filas.push(`  "${clave}": [${JSON.stringify(ciudad)}, ${JSON.stringify(provincia)}],`);
}

const cabecera = `// Características telefónicas de Argentina → [ciudad, provincia]. Lo usa phone-geo.ts.
// NO editar a mano: se genera con src/scripts/gen-ar-areas.mjs desde Google libphonenumber,
// resources/geocoding/es/54.txt (Apache-2.0, https://github.com/google/libphonenumber).
// La clave es "54" + los primeros dígitos del número nacional (la característica, a veces más
// dígitos del abonado): se busca por prefijo más largo. Ciudad "" = la característica abarca varias
// localidades → va solo la provincia. Los retoques sobre el original están en el generador.
export const AR_AREAS: Readonly<Record<string, readonly [ciudad: string, provincia: string]>> = {
`;
const salida = new URL("../lib/ar-areas.ts", import.meta.url);
writeFileSync(salida, cabecera + filas.join("\n") + "\n};\n");
console.log(`${filas.length} características → ${salida.pathname}`);
