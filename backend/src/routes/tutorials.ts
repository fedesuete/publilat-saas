// Tutoriales en video del panel.
//  - tutorialsRouter (cliente, requireAuth): lista los tutoriales ACTIVOS para /tutoriales.
//  - tutorialsAdminRouter (admin, requireAdmin): ABM de tutoriales desde el panel maestro.
//  - tutorialVideoRouter (PÚBLICO): sirve los videos SUBIDOS a Publi (S3 privado) con soporte de
//    Range. Es propio → sin YouTube, sin recomendaciones al final, sin logo. Alternativa a pegar
//    un link de YouTube/Vimeo (que igual sigue soportado).
import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import multer from "multer";
import { prisma } from "../lib/prisma.js";
import { s3Enabled, uploadBuffer, getS3Object } from "../lib/s3.js";

export const tutorialsRouter = Router();
export const tutorialsAdminRouter = Router();
export const tutorialVideoRouter = Router();

// Tope de tamaño del video subido (memoria → S3). Videos largos/pesados: subir a YouTube/Vimeo.
const VIDEO_MAX_MB = 200;
const uploadVideo = multer({ storage: multer.memoryStorage(), limits: { fileSize: VIDEO_MAX_MB * 1024 * 1024 } });

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
    const f = (req as any).file as { buffer: Buffer; mimetype: string; originalname: string } | undefined;
    if (!f) return res.status(400).json({ error: "Falta el archivo de video." });
    if (!/^video\//.test(f.mimetype || "")) return res.status(400).json({ error: "El archivo no parece un video." });
    if (!s3Enabled())
      return res.status(500).json({ error: "El almacenamiento de videos no está configurado en el servidor." });
    const ext = (f.originalname.match(/\.([A-Za-z0-9]{2,5})$/)?.[1] || "mp4").toLowerCase();
    const name = `${crypto.randomUUID()}.${ext}`;
    const stored = await uploadBuffer(`tutorials/${name}`, f.buffer, f.mimetype || "video/mp4");
    if (!stored) return res.status(500).json({ error: "No se pudo guardar el video. Probá de nuevo." });
    const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] || req.protocol || "https";
    const videoUrl = `${proto}://${req.get("host")}/api/tutorial-video/${name}`;
    return res.json({ videoUrl });
  },
);

// ---- Público: sirve el video subido desde S3 (bucket privado) con soporte de Range (seek) ----
// El <video> del navegador no manda token → ruta pública, pero acotada al prefijo tutorials/ y a
// un nombre saneado (nada de rutas ni "..") para no exponer otros objetos del bucket.
tutorialVideoRouter.get("/:name", async (req, res) => {
  const name = req.params.name;
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) return res.status(400).end();
  const range = typeof req.headers.range === "string" ? req.headers.range : undefined;
  const obj = await getS3Object(`tutorials/${name}`, range);
  if (!obj) return res.status(404).end();
  if (obj.contentType) res.setHeader("Content-Type", obj.contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=86400");
  if (obj.contentRange) res.setHeader("Content-Range", obj.contentRange);
  if (obj.contentLength != null) res.setHeader("Content-Length", String(obj.contentLength));
  res.status(range && obj.contentRange ? 206 : 200);
  const body = obj.body;
  if (body && typeof body.pipe === "function") {
    body.on("error", () => { if (!res.headersSent) res.status(500); res.end(); });
    body.pipe(res);
  } else {
    res.end();
  }
});
