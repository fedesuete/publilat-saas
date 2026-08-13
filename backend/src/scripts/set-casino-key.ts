// Setea (o limpia) la API key del casino de UNA cuenta (partner-api multi-tenant). La cifra en reposo
// con APP_ENCRYPTION_KEY del .env -> CORRERLO EN EL SERVER (misma clave que usa la app para descifrar).
// Uso:
//   CASINO_ACCOUNT_EMAIL=jpmunna73@gmail.com CASINO_ACCOUNT_KEY=ptk_fortuna_xxx node dist/scripts/set-casino-key.js
//   CASINO_ACCOUNT_EMAIL=algun@mail CASINO_ACCOUNT_KEY= node dist/scripts/set-casino-key.js   (vacío = quita la key -> vuelve a legacy)
import { prisma } from "../lib/prisma.js";
import { encryptSecret, maskSecret } from "../lib/crypto.js";

async function main() {
  const email = (process.env.CASINO_ACCOUNT_EMAIL ?? "").trim();
  const plainKey = (process.env.CASINO_ACCOUNT_KEY ?? "").trim(); // vacío = limpiar
  if (!email) {
    console.error("[set-casino-key] falta CASINO_ACCOUNT_EMAIL");
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, casinoApiKey: true } });
  if (!user) {
    console.error(`[set-casino-key] no existe un usuario con email ${email}`);
    process.exit(1);
  }
  const value = plainKey ? encryptSecret(plainKey) : null;
  await prisma.user.update({ where: { id: user.id }, data: { casinoApiKey: value } });
  console.log(
    plainKey
      ? `[set-casino-key] OK -> ${user.email} (${user.id}) casinoApiKey = ${maskSecret(plainKey)} (cifrada)`
      : `[set-casino-key] OK -> ${user.email} (${user.id}) casinoApiKey LIMPIADA (vuelve a la key global legacy)`,
  );
}

main()
  .catch((e) => {
    console.error("[set-casino-key] error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
