// Uniquificador de audios: cada envío de un audio de la biblioteca se re-encodea con pequeñas
// variaciones aleatorias (silencio al inicio/fin, micro-volumen, metadata) para que el archivo
// tenga un hash/fingerprint distinto cada vez. Así WhatsApp no lo detecta como "el mismo audio"
// mandado en masa. Las variaciones son a nivel de CONTENIDO (silencio + volumen) => sobreviven
// aunque el motor (WAHA/Cloud) vuelva a transcodear. Requiere ffmpeg en el contenedor (ya está).
import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rnd = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Toma los bytes de un audio (cualquier formato) y devuelve un OGG/OPUS único: mismo audio a
 * oído, distinto byte a byte (hash y fingerprint diferentes). Las variaciones son imperceptibles.
 */
export async function uniquifyAudio(input: Buffer): Promise<Buffer> {
  const lead = Math.round(rnd(10, 130)); // ms de silencio al inicio (adelay) -> cambia la cantidad de samples
  const trail = rnd(0.01, 0.13).toFixed(3); // s de silencio al final (apad)
  const vol = rnd(0.95, 1.04).toFixed(3); // micro-variación de volumen
  const bitrate = Math.round(rnd(30, 40)); // kbps (jitter de bitrate)
  const tag = Math.random().toString(36).slice(2) + Date.now().toString(36);

  const tmp = join(tmpdir(), `pl-aud-${process.pid}-${Date.now()}-${Math.round(Math.random() * 1e9)}.bin`);
  await writeFile(tmp, input);
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const ff = spawn("ffmpeg", [
        "-hide_banner", "-loglevel", "error",
        "-i", tmp,
        "-vn",
        "-af", `adelay=${lead}:all=1,apad=pad_dur=${trail},volume=${vol}`,
        "-c:a", "libopus", "-b:a", `${bitrate}k`,
        "-metadata", `comment=${tag}`,
        "-f", "ogg", "pipe:1",
      ]);
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      ff.stdout.on("data", (d) => out.push(d));
      ff.stderr.on("data", (d) => err.push(d));
      ff.on("error", (e) => reject(new Error("ffmpeg no disponible: " + e.message)));
      ff.on("close", (code) =>
        code === 0 && out.length
          ? resolve(Buffer.concat(out))
          : reject(new Error("ffmpeg falló: " + Buffer.concat(err).toString().slice(-300))));
    });
  } finally {
    await unlink(tmp).catch(() => { /* limpieza best-effort */ });
  }
}
