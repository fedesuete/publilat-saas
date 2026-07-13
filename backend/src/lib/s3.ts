// Publicación de landings en almacenamiento S3-compatible + CDN (Fase 5). GATEADO por .env.
// Sirve la landing desde un dominio que NO es el de la marca (CDN), para no quemar la
// reputación del dominio principal si Meta marca el contenido de un cliente.
//
// Compatible con AWS S3, DigitalOcean Spaces, Cloudflare R2, Backblaze B2, etc.
// Si no está configurado (o falta el SDK), devuelve null y el caller sirve desde /p/:slug.
//
// Habilitar:
//   npm i @aws-sdk/client-s3   (ya en package.json)
//   .env:
//     AWS_S3_BUCKET=...            (nombre del bucket/space)
//     AWS_REGION=...               (ej: us-east-1 / nyc3 / auto)
//     AWS_ACCESS_KEY_ID=...        (key del proveedor)
//     AWS_SECRET_ACCESS_KEY=...    (secret del proveedor)
//     CLOUDFRONT_DOMAIN=...        (host PÚBLICO del CDN, ej: d123.cloudfront.net o
//                                   mibucket.nyc3.cdn.digitaloceanspaces.com)
//     S3_ENDPOINT=...              (opcional; solo si NO es AWS. Ej DO Spaces:
//                                   https://nyc3.digitaloceanspaces.com)
//     S3_PUBLIC_ACL=true           (opcional; pone los objetos public-read al subir.
//                                   AWS moderno: dejarlo vacío y usar bucket policy)
const BUCKET = process.env.AWS_S3_BUCKET ?? "";
const REGION = process.env.AWS_REGION ?? "us-east-1";
const CF_DOMAIN = (process.env.CLOUDFRONT_DOMAIN ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const ENDPOINT = process.env.S3_ENDPOINT ?? "";
const PUBLIC_ACL = process.env.S3_PUBLIC_ACL === "true";

export function s3Enabled(): boolean {
  return Boolean(BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

// URL pública del objeto. Prioriza el CDN (off-brand). Si no, arma la del proveedor.
function publicUrl(key: string): string {
  if (CF_DOMAIN) return `https://${CF_DOMAIN}/${key}`;
  if (ENDPOINT) {
    const host = ENDPOINT.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${BUCKET}.${host}/${key}`; // virtual-hosted (DO Spaces, R2)
  }
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}

// Sube HTML a un key EXACTO del bucket (ej "joaco/promo/index.html"). Devuelve true/false.
// Lo usa el modelo por-cliente (CloudFront): el key lleva el prefijo del cliente.
export async function uploadHtml(key: string, html: string): Promise<boolean> {
  if (!s3Enabled()) return false;
  try {
    const specifier = "@aws-sdk/client-s3";
    const mod: any = await import(specifier).catch(() => null);
    if (!mod) return false;
    const { S3Client, PutObjectCommand } = mod;
    const client = new S3Client({ region: REGION, ...(ENDPOINT ? { endpoint: ENDPOINT, forcePathStyle: false } : {}) });
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: html,
        ContentType: "text/html; charset=utf-8",
        CacheControl: "public, max-age=300",
      }),
    );
    return true;
  } catch (e) {
    console.error("[s3] uploadHtml error:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

// Sube un buffer binario (ej: logo del branding) a un key EXACTO y devuelve la URL pública
// (CDN/S3). null si S3 no está configurado o falla — el caller decide el fallback (data URL).
export async function uploadBuffer(key: string, body: Buffer, contentType: string): Promise<string | null> {
  if (!s3Enabled()) return null;
  try {
    const specifier = "@aws-sdk/client-s3";
    const mod: any = await import(specifier).catch(() => null);
    if (!mod) return null;
    const { S3Client, PutObjectCommand } = mod;
    const client = new S3Client({ region: REGION, ...(ENDPOINT ? { endpoint: ENDPOINT, forcePathStyle: false } : {}) });
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable", // nombre aleatorio -> cache eterno
        ...(PUBLIC_ACL ? { ACL: "public-read" } : {}),
      }),
    );
    return publicUrl(key);
  } catch (e) {
    console.error("[s3] uploadBuffer error:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

// Sube el HTML como <slug>/index.html y devuelve la URL pública (CDN/S3). null si falla.
export async function publishToS3(slug: string, html: string): Promise<string | null> {
  if (!s3Enabled()) return null;
  try {
    // Import dinámico: el SDK es opcional y no se resuelve en tiempo de compilación.
    const specifier = "@aws-sdk/client-s3";
    const mod: any = await import(specifier).catch(() => null);
    if (!mod) {
      console.warn("[s3] @aws-sdk/client-s3 no instalado; serví la landing localmente");
      return null;
    }
    const { S3Client, PutObjectCommand } = mod;
    const client = new S3Client({
      region: REGION,
      ...(ENDPOINT ? { endpoint: ENDPOINT, forcePathStyle: false } : {}),
    });
    const key = `${slug}/index.html`;
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: html,
        ContentType: "text/html; charset=utf-8",
        CacheControl: "public, max-age=300",
        ...(PUBLIC_ACL ? { ACL: "public-read" } : {}),
      })
    );
    return publicUrl(key);
  } catch (e) {
    console.error("[s3] publish error:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
