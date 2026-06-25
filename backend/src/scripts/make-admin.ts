// Promueve a ADMIN al usuario del email indicado (ADMIN_EMAIL o el default).
// Uso: node dist/scripts/make-admin.js   (o tsx src/scripts/make-admin.ts)
import { prisma } from "../lib/prisma.js";

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "federicobogado1997@gmail.com";
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`[make-admin] no existe un usuario con email ${email}. Registralo primero.`);
    process.exit(1);
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role: "ADMIN" },
    select: { email: true, role: true },
  });
  console.log(`[make-admin] OK -> ${updated.email} es ${updated.role}`);
}

main()
  .catch((e) => {
    console.error("[make-admin] error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
