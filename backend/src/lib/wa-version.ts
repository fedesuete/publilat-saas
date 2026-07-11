// Vigilancia de la versión de WhatsApp Web fijada en Evolution (CONFIG_SESSION_PHONE_VERSION).
// Las versiones EXPIRAN a los ~2 meses: con una vencida, la sesión conecta y RECIBE pero
// WhatsApp descarta los envíos EN SILENCIO (primera capa del incidente fortune 03/07/2026).
// Fuente: repo wppconnect-team/wa-version — cada entrada trae released/expire por versión.
import axios from "axios";

const VERSIONS_URL = "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/versions.json";

// El repo publica "2.3000.x-alpha"; Evolution la usa sin sufijo.
const norm = (v: string) => v.trim().replace(/-(alpha|beta)$/i, "");

export interface WaVersionStatus {
  pinned: string; // la versión fijada en el .env (normalizada)
  latest: string; // currentVersion del repo (normalizada) — a esta hay que actualizar
  expiresAt: Date | null; // vencimiento de la fijada; null = ya no figura (vencida/podada)
  daysLeft: number | null; // días hasta el vencimiento; null = ya no figura
  needsAction: boolean; // vencida, por vencer (<=7 días) o desconocida
}

// Devuelve null si no hay versión fijada en el env o si el fetch falla (se reintenta
// en el próximo ciclo del job; no es crítico fallar una vuelta).
export async function checkWaWebVersion(): Promise<WaVersionStatus | null> {
  const pinnedRaw = process.env.CONFIG_SESSION_PHONE_VERSION ?? "";
  if (!pinnedRaw) {
    console.warn("[wa-version] CONFIG_SESSION_PHONE_VERSION no está en el env del backend: el vigía de versión queda ciego (agregala al .env)");
    return null;
  }
  const pinned = norm(pinnedRaw);
  try {
    const { data } = await axios.get(VERSIONS_URL, { timeout: 15000 });
    const latest = norm(String(data?.currentVersion ?? ""));
    const list: Array<{ version?: string; expire?: string }> = Array.isArray(data?.versions)
      ? data.versions
      : [];
    const entry = list.find((v) => norm(String(v.version ?? "")) === pinned);
    // El repo poda las versiones vencidas: si la fijada no figura, ya venció (o es inválida).
    const expiresAt = entry?.expire ? new Date(entry.expire) : null;
    const daysLeft = expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000) : null;
    const needsAction = daysLeft === null || daysLeft <= 7;
    return { pinned, latest, expiresAt, daysLeft, needsAction };
  } catch (e) {
    console.warn("[wa-version] no se pudo consultar versions.json:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
