// Tutoriales en video del panel.
//  - tutorialsRouter (cliente, requireAuth): lista los tutoriales ACTIVOS para /tutoriales.
//  - tutorialsAdminRouter (admin, requireAdmin): ABM de tutoriales desde el panel maestro.
//  - tutorialVideoRouter (PÚBLICO): sirve los videos SUBIDOS a Publi (S3 privado) con soporte de
//    Range. Es propio → sin YouTube, sin recomendaciones al final, sin logo. Alternativa a pegar
//    un link de YouTube/Vimeo (que igual sigue soportado).
import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { prisma } from "../lib/prisma.js";

export const tutorialsRouter = Router();
export const tutorialsAdminRouter = Router();
export const tutorialVideoRouter = Router();

// Los videos subidos se guardan en el disco (volumen persistente), NO en S3 (las credenciales
// de S3 del server solo suben landings; no tienen permiso de lectura). En local cae a ./data.
const VIDEO_MAX_MB = 200;
const TUT_DIR = process.env.TUTORIALS_DIR || path.resolve(process.cwd(), "data/tutorials");
try { fs.mkdirSync(TUT_DIR, { recursive: true }); } catch { /* se crea al primer upload si hace falta */ }

const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4", webm: "video/webm", ogg: "video/ogg", ogv: "video/ogg",
  mov: "video/quicktime", m4v: "video/x-m4v",
};

const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TUT_DIR),
    filename: (_req, file, cb) => {
      const ext = (file.originalname.match(/\.([A-Za-z0-9]{2,5})$/)?.[1] || "mp4").toLowerCase();
      cb(null, `${crypto.randomUUID()}.${ext}`);
    },
  }),
  limits: { fileSize: VIDEO_MAX_MB * 1024 * 1024 },
});

// ---- Cliente: sólo los activos, ordenados ----
tutorialsRouter.get("/", async (_req, res) => {
  const tutorials = await prisma.tutorial.findMany({
    where: { active: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true, description: true, videoUrl: true },
  });
  return res.json({ tutorials });
});

// ---- Admin: ABM completo ----
const upsertSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  videoUrl: z.string().url("El link del video no es válido").max(500),
  order: z.number().int().optional(),
  active: z.boolean().optional(),
});

// GET /api/admin/tutorials — todos (incluye inactivos), ordenados.
tutorialsAdminRouter.get("/", async (_req, res) => {
  const tutorials = await prisma.tutorial.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return res.json({ tutorials });
});

// POST /api/admin/tutorials — crea. Si no mandan orden, lo pone al final.
tutorialsAdminRouter.post("/", async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const { title, description, videoUrl, order, active } = parsed.data;
  const nextOrder = order ?? (((await prisma.tutorial.aggregate({ _max: { order: true } }))._max.order ?? 0) + 1);
  const tutorial = await prisma.tutorial.create({
    data: { title, description: description ?? null, videoUrl, order: nextOrder, active: active ?? true },
  });
  return res.status(201).json({ tutorial });
});

// PUT /api/admin/tutorials/:id — actualiza campos.
tutorialsAdminRouter.put("/:id", async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Input inválido", details: parsed.error.flatten() });
  const existing = await prisma.tutorial.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Tutorial no encontrado" });
  const d = parsed.data;
  const tutorial = await prisma.tutorial.update({
    where: { id: existing.id },
    data: {
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.description !== undefined ? { description: d.description ?? null } : {}),
      ...(d.videoUrl !== undefined ? { videoUrl: d.videoUrl } : {}),
      ...(d.order !== undefined ? { order: d.order } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
    },
  });
  return res.json({ tutorial });
});

// DELETE /api/admin/tutorials/:id
tutorialsAdminRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.tutorial.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Tutorial no encontrado" });
  await prisma.tutorial.delete({ where: { id: existing.id } });
  // Si el video estaba subido a Publi (disco), borro el archivo para no dejar huérfanos.
  const m = existing.videoUrl.match(/\/api\/tutorial-video\/([A-Za-z0-9._-]+)$/);
  if (m && !m[1].includes("..")) { try { fs.unlinkSync(path.join(TUT_DIR, m[1])); } catch { /* ya no está */ } }
  return res.json({ ok: true });
});

// POST /api/admin/tutorials/upload — sube un video (.mp4/.webm/.mov) al almacenamiento PROPIO
// (S3 privado) y devuelve una URL servida por NUESTRO backend. Así el tutorial se ve sin YouTube
// (sin recomendaciones al final, sin logo). Campo del form-data: "video".
tutorialsAdminRouter.post(
  "/upload",
  (req, res, next) =>
    uploadVideo.single("video")(req, res, (err: any) => {
      if (err) {
        const msg =
          err?.code === "LIMIT_FILE_SIZE"
            ? `El video supera ${VIDEO_MAX_MB} MB. Comprimilo/acortalo, o subilo a YouTube y pegá el link.`
            : "No se pudo subir el video.";
        return res.status(400).json({ error: msg });
      }
      next();
    }),
  async (req, res) => {
    const f = (req as any).file as { filename: string; mimetype: string; path: string } | undefined;
    if (!f) return res.status(400).json({ error: "Falta el archivo de video." });
    // multer ya lo escribió a disco; si no es video, lo borro.
    if (!/^video\//.test(f.mimetype || "")) {
      try { fs.unlinkSync(f.path); } catch { /* ignore */ }
      return res.status(400).json({ error: "El archivo no parece un video." });
    }
    const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] || req.protocol || "https";
    const videoUrl = `${proto}://${req.get("host")}/api/tutorial-video/${f.filename}`;
    return res.json({ videoUrl });
  },
);

// ---- Público: sirve el video subido desde el disco con soporte de Range (seek) ----
// El <video> del navegador no manda token → ruta pública, pero acotada a TUT_DIR y a un nombre
// saneado (nada de rutas ni "..") para no exponer otros archivos.
tutorialVideoRouter.get("/:name", (req, res) => {
  const name = req.params.name;
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) return res.status(400).end();
  const filePath = path.join(TUT_DIR, name);
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return res.status(404).end();
    const total = stat.size;
    const ext = (name.match(/\.([A-Za-z0-9]+)$/)?.[1] || "mp4").toLowerCase();
    res.setHeader("Content-Type", VIDEO_MIME[ext] || "application/octet-stream");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=86400");
    const range = req.headers.range;
    if (typeof range === "string") {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
      if (!Number.isFinite(start) || start < 0) start = 0;
      if (!Number.isFinite(end) || end >= total) end = total - 1;
      if (start > end) {
        res.setHeader("Content-Range", `bytes */${total}`);
        return res.status(416).end();
      }
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", String(end - start + 1));
      const s = fs.createReadStream(filePath, { start, end });
      s.on("error", () => res.destroy());
      s.pipe(res);
    } else {
      res.status(200);
      res.setHeader("Content-Length", String(total));
      const s = fs.createReadStream(filePath);
      s.on("error", () => res.destroy());
      s.pipe(res);
    }
  });
});
