// Publicación de landings en S3 + CloudFront (Fase 5). GATEADO por .env.
// Si no hay AWS_S3_BUCKET (o el SDK no está instalado), devuelve null y el caller sirve
// la landing desde el propio backend (/p/:slug). Para habilitar S3:
//   npm i @aws-sdk/client-s3
//   y completar AWS_* + CLOUDFRONT_DOMAIN en .env
const BUCKET = process.env.AWS_S3_BUCKET ?? "";
const REGION = process.env.AWS_REGION ?? "us-east-1";
const CF_DOMAIN = process.env.CLOUDFRONT_DOMAIN ?? "";

export function s3Enabled(): boolean {
  return Boolean(BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

// Sube el HTML como <slug>/index.html y devuelve la URL pública (CloudFront o S3).
// Devuelve null si no está configurado o si el SDK no está disponible.
export async function publishToS3(slug: string, html: string): Promise<string | null> {
  if (!s3Enabled()) return null;
  try {
    // Import dinámico con specifier en variable: el SDK es opcional y no se resuelve en
    // tiempo de compilación (no rompe el build si no está instalado).
    const specifier = "@aws-sdk/client-s3";
    const mod: any = await import(specifier).catch(() => null);
    if (!mod) {
      console.warn("[s3] @aws-sdk/client-s3 no instalado; serví la landing localmente");
      return null;
    }
    const { S3Client, PutObjectCommand } = mod;
    const client = new S3Client({ region: REGION });
    const key = `${slug}/index.html`;
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: html,
        ContentType: "text/html; charset=utf-8",
        CacheControl: "public, max-age=300",
      })
    );
    return CF_DOMAIN ? `https://${CF_DOMAIN}/${key}` : `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
  } catch (e) {
    console.error("[s3] publish error:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
