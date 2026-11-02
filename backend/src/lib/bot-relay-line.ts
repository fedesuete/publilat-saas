// Resuelve por qué línea sale un /send del bot de socio (bot-relay).
//
// El bot guarda por jugador el lineId por el que escribió. Si el cliente borra y re-escanea su
// número (raul lo hizo 2 veces en 48 h, 11/09/2026), ese lineId deja de existir y el /send daba
// 404 → el aviso de carga se perdía en silencio. Con `ownerUserId` (la cuenta dueña, que el bot ya
// conoce) caemos a la línea conectada de esa cuenta. Sin ownerUserId, comportamiento de siempre.

export type RelayLine = { id: string; userId: string };

// Tipo estructural laxo: acepta el PrismaClient real (sus métodos son genéricos) y un fake en tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RelayDb = { waLine: { findUnique: (args: any) => Promise<any>; findFirst: (args: any) => Promise<any> } };

export async function resolveRelayLine(
  db: RelayDb,
  args: { lineId: string; ownerUserId?: string },
): Promise<{ line: RelayLine; fallback: boolean } | null> {
  const asked: (RelayLine & { connected: boolean }) | null = await db.waLine.findUnique({ where: { id: args.lineId }, select: { id: true, userId: true, connected: true } });
  if (asked?.connected) return { line: { id: asked.id, userId: asked.userId }, fallback: false };
  if (!args.ownerUserId) return null;
  const live: RelayLine | null = await db.waLine.findFirst({
    where: { userId: args.ownerUserId, connected: true, status: "active" },
    orderBy: [{ lastUsedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, userId: true },
  });
  return live ? { line: live, fallback: true } : null;
}
