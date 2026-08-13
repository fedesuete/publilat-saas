// Carga (o actualiza) el proxy IPRoyal RESIDENCIAL AR en el pool, leyendo las credenciales del .env
// (NUNCA de git). La pass se cifra en reposo (encryptSecret). Sticky por línea hasta 7 días: el país +
// la sesión + el lifetime se arman en runtime en buildProxyConfig (proxy-pool). CORRERLO EN EL SERVER
// (misma APP_ENCRYPTION_KEY que usa la app para descifrar).
// Uso:
//   IPROYAL_HOST=geo.iproyal.com IPROYAL_PORT=12321 IPROYAL_USER=... IPROYAL_PASS=... \
//     node dist/scripts/add-iproyal-proxy.js
//   (opcionales: IPROYAL_COUNTRY=ar  IPROYAL_MAX_LINES=10)
import { prisma } from "../lib/prisma.js";
import { encryptSecret, maskSecret } from "../lib/crypto.js";
import { IPROYAL_PROVIDER } from "../lib/proxy-pool.js";

async function main() {
  const host = (process.env.IPROYAL_HOST ?? "geo.iproyal.com").trim();
  const port = Number(process.env.IPROYAL_PORT ?? "12321");
  const user = (process.env.IPROYAL_USER ?? "").trim();
  const pass = (process.env.IPROYAL_PASS ?? "").trim();
  const country = (process.env.IPROYAL_COUNTRY ?? "ar").trim().toLowerCase();
  const maxLines = Number(process.env.IPROYAL_MAX_LINES ?? "10");
  if (!user || !pass) {
    console.error("[add-iproyal-proxy] faltan IPROYAL_USER / IPROYAL_PASS en el .env");
    process.exit(1);
  }
  if (!Number.isFinite(port) || port <= 0) {
    console.error("[add-iproyal-proxy] IPROYAL_PORT inválido");
    process.exit(1);
  }
  const data = {
    label: "IPRoyal Residencial AR (sticky 7d)",
    provider: IPROYAL_PROVIDER,
    host,
    port,
    username: user,
    password: encryptSecret(pass),
    protocol: "http",
    country,
    sticky: true,
    sessTime: 10080, // 7 días en minutos (informativo; el lifetime real va en la password: lifetime-7d)
    maxLines,
    active: true,
    healthy: true, // ya validado por curl; la Fase 2 agrega el health-check continuo
  };
  const existing = await prisma.proxy.findFirst({ where: { provider: IPROYAL_PROVIDER, host } });
  const saved = existing
    ? await prisma.proxy.update({ where: { id: existing.id }, data })
    : await prisma.proxy.create({ data });
  console.log(
    `[add-iproyal-proxy] OK -> ${existing ? "actualizado" : "creado"} proxy ${saved.id} ` +
      `(${saved.provider} ${saved.host}:${saved.port}, user=${saved.username}, pass=${maskSecret(pass)}, ` +
      `country=${saved.country}, sticky=${saved.sticky}, maxLines=${saved.maxLines}, active=${saved.active}, healthy=${saved.healthy})`,
  );
}

main()
  .catch((e) => {
    console.error("[add-iproyal-proxy] error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
