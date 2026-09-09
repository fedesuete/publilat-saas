// Baja la ÚLTIMA imagen del chat de un lead de Kommo vía su API de Archivos (drive). Kommo NO manda
// el archivo en el webhook (llega un placeholder de texto), pero SÍ registra los adjuntos del chat
// como archivos del lead: GET /api/v4/leads/{id}/files → uuids → el drive de la cuenta
// (account.drive_url) lista los archivos con link de descarga (Bearer del cliente). Verificado en
// vivo 2026-09-09 (JPEG real bajado del chat de raul). Es la pieza que permite leer el comprobante
// con IA sin sacar el WhatsApp de Kommo.
import { prisma } from "./prisma.js";
import { decryptSecret } from "./crypto.js";

const MAX_BYTES = 8 * 1024 * 1024; // comprobantes: sobra
const IMG_HREF_RE = /\.(jpe?g|png|webp|gif)(\?|$)/i;

export type KommoLeadImage = { base64: string; mime: string };

export async function fetchLatestKommoLeadImage(userId: string, kommoLeadId: string): Promise<KommoLeadImage | null> {
  if (!/^\d+$/.test(kommoLeadId)) return null;
  const integ = await prisma.integration.findUnique({ where: { userId }, select: { kommoBaseUrl: true, kommoToken: true } });
  if (!integ?.kommoBaseUrl || !integ.kommoToken) return null;
  let token: string;
  try { token = decryptSecret(integ.kommoToken); } catch { return null; }
  const H = { Authorization: `Bearer ${token}` };
  const base = integ.kommoBaseUrl.replace(/\/$/, ""); // ya validada *.kommo.com al guardarse (SSRF)

  // 1) uuids de los archivos del lead (id más alto = más nuevo).
  const filesR = await fetch(`${base}/api/v4/leads/${kommoLeadId}/files`, { headers: H });
  if (filesR.status !== 200) return null;
  const filesBody = (await filesR.json().catch(() => null)) as { _embedded?: { files?: { file_uuid?: string; id?: number }[] } } | null;
  const uuids = (filesBody?._embedded?.files ?? [])
    .map((f) => ({ uuid: String(f.file_uuid ?? ""), id: Number(f.id ?? 0) }))
    .filter((f) => f.uuid)
    .sort((a, b) => b.id - a.id)
    .slice(0, 5);
  if (!uuids.length) return null;

  // 2) drive de la cuenta (dominio kommo/amocrm SIEMPRE — no seguimos URLs arbitrarias).
  const accR = await fetch(`${base}/api/v4/account?with=drive_url`, { headers: H });
  if (!accR.ok) return null;
  const driveUrl = String(((await accR.json().catch(() => null)) as { drive_url?: string } | null)?.drive_url ?? "").replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.(kommo|amocrm)\.com$/.test(driveUrl)) return null;

  // 3) listado del drive: cada entrada trae el link de descarga (el uuid viaja dentro del href).
  const listR = await fetch(`${driveUrl}/v1.0/files?limit=50&order[created_at]=desc`, { headers: H });
  if (!listR.ok) return null;
  const listBody = (await listR.json().catch(() => null)) as { _embedded?: { files?: { _links?: { download?: { href?: string } } }[] } } | null;
  const entries = (listBody?._embedded?.files ?? [])
    .map((f) => String(f?._links?.download?.href ?? ""))
    .filter((href) => href.startsWith(driveUrl + "/"));

  // 4) del más nuevo al más viejo: si el archivo del lead es una imagen, la bajamos.
  for (const { uuid } of uuids) {
    const href = entries.find((h) => h.includes(uuid));
    if (!href || !IMG_HREF_RE.test(href)) continue;
    try {
      const imgR = await fetch(href, { headers: H, redirect: "follow" });
      if (!imgR.ok) continue;
      const mime = (imgR.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
      if (!/^image\//.test(mime)) continue;
      const buf = Buffer.from(await imgR.arrayBuffer());
      if (!buf.length || buf.length > MAX_BYTES) continue;
      return { base64: buf.toString("base64"), mime };
    } catch { /* probamos el siguiente */ }
  }
  return null;
}
