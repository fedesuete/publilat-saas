// Aislamiento de landings estilo ScaleOS: una distribución de CloudFront POR CLIENTE, con
// su propio dominio *.cloudfront.net (descartable). Si Meta quema una landing, cae solo ese
// dominio — no publi.lat ni las landings de otros clientes.
//
// Modelo AWS: bucket S3 PRIVADO + Origin Access Control (OAC). La distribución del cliente
// apunta al bucket con OriginPath = /{s3Prefix} (la carpeta del cliente). Una bucket policy
// permite que SOLO CloudFront de ESTA cuenta lea el bucket. Landings en {s3Prefix}/{slug}/index.html.
//
// Gateado por s3Enabled() (mismas credenciales AWS que lib/s3.ts). Import dinámico del SDK.
import { s3Enabled } from "./s3.js";
import { prisma } from "./prisma.js";

const REGION = process.env.AWS_REGION ?? "us-east-2";
const BUCKET = process.env.AWS_S3_BUCKET ?? "";
const ACCOUNT_ID = process.env.AWS_ACCOUNT_ID ?? "";
const OAC_NAME = "publilat-landings-oac";

// El dominio de origen del bucket (regional). us-east-1 usa un host sin región.
function bucketDomain(): string {
  return REGION === "us-east-1"
    ? `${BUCKET}.s3.amazonaws.com`
    : `${BUCKET}.s3.${REGION}.amazonaws.com`;
}

async function cfClient() {
  const m: any = await import("@aws-sdk/client-cloudfront");
  return { m, client: new m.CloudFrontClient({ region: "us-east-1" }) }; // CloudFront es global
}

// OAC compartido por todas las distribuciones (todas leen el mismo bucket). Idempotente:
// si ya existe uno con nuestro nombre, lo reusa.
async function ensureOac(): Promise<string> {
  const { m, client } = await cfClient();
  const list = await client.send(new m.ListOriginAccessControlsCommand({}));
  const existing = (list.OriginAccessControlList?.Items ?? []).find((o: any) => o.Name === OAC_NAME);
  if (existing?.Id) return existing.Id;
  const created = await client.send(
    new m.CreateOriginAccessControlCommand({
      OriginAccessControlConfig: {
        Name: OAC_NAME,
        SigningProtocol: "sigv4",
        SigningBehavior: "always",
        OriginAccessControlOriginType: "s3",
      },
    }),
  );
  return created.OriginAccessControl!.Id!;
}

// Bucket policy: permite a CloudFront de NUESTRA cuenta leer el bucket (OAC). Se aplica una
// vez; es acumulativa por cuenta (no por distribución), así vale para todas las del cliente.
async function ensureBucketPolicy(): Promise<void> {
  const s3: any = await import("@aws-sdk/client-s3");
  const client = new s3.S3Client({ region: REGION });
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowCloudFrontOAC",
        Effect: "Allow",
        Principal: { Service: "cloudfront.amazonaws.com" },
        Action: "s3:GetObject",
        Resource: `arn:aws:s3:::${BUCKET}/*`,
        ...(ACCOUNT_ID ? { Condition: { StringEquals: { "AWS:SourceAccount": ACCOUNT_ID } } } : {}),
      },
    ],
  };
  await client.send(new s3.PutBucketPolicyCommand({ Bucket: BUCKET, Policy: JSON.stringify(policy) }));
}

export interface ClientDistribution {
  domain: string; // xxxx.cloudfront.net
  distId: string;
}

// Crea una distribución CloudFront nueva para el cliente (dominio descartable). OriginPath
// = /{s3Prefix}. Devuelve el dominio + id. La distribución tarda ~5-15 min en desplegar la
// primera vez, pero el dominio ya es utilizable enseguida.
export async function createClientDistribution(s3Prefix: string): Promise<ClientDistribution | null> {
  if (!s3Enabled() || !BUCKET) return null;
  const oacId = await ensureOac();
  await ensureBucketPolicy().catch((e) =>
    console.warn("[cloudfront] no se pudo aplicar la bucket policy:", e instanceof Error ? e.message : String(e)));
  const { m, client } = await cfClient();
  const originId = "s3-landings";
  const ref = `publilat-${s3Prefix}-${Date.now()}`; // CallerReference único
  const res = await client.send(
    new m.CreateDistributionCommand({
      DistributionConfig: {
        CallerReference: ref,
        Comment: `publilat landings ${s3Prefix}`,
        Enabled: true,
        DefaultRootObject: "index.html",
        Origins: {
          Quantity: 1,
          Items: [
            {
              Id: originId,
              DomainName: bucketDomain(),
              OriginPath: `/${s3Prefix}`,
              S3OriginConfig: { OriginAccessIdentity: "" }, // OAC (no el legacy OAI)
              OriginAccessControlId: oacId,
            },
          ],
        },
        DefaultCacheBehavior: {
          TargetOriginId: originId,
          ViewerProtocolPolicy: "redirect-to-https",
          Compress: true,
          AllowedMethods: { Quantity: 2, Items: ["GET", "HEAD"], CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] } },
          // Managed policy "CachingOptimized" (id fijo de AWS).
          CachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6",
        },
        PriceClass: "PriceClass_All", // incluye edges de Sudamérica
      },
    }),
  );
  const dist = res.Distribution;
  if (!dist?.DomainName || !dist?.Id) return null;
  return { domain: dist.DomainName, distId: dist.Id };
}

// Asegura que el cliente tenga su carpeta S3 (s3Prefix) y su distribución CloudFront.
// Idempotente: si ya las tiene, las devuelve; si no, las crea y persiste. Devuelve null si
// AWS no está configurado (el caller cae al servido local /p/:slug).
export interface ClientCdn { s3Prefix: string; cloudfrontDomain: string; cloudfrontDistId: string }

export async function ensureClientCdn(userId: string): Promise<ClientCdn | null> {
  if (!s3Enabled() || !BUCKET) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, slug: true, s3Prefix: true, cloudfrontDomain: true, cloudfrontDistId: true },
  });
  if (!user) return null;

  const s3Prefix = user.s3Prefix ?? user.slug;
  // ¿Ya tiene distribución? La reusamos.
  if (user.cloudfrontDomain && user.cloudfrontDistId) {
    if (!user.s3Prefix) await prisma.user.update({ where: { id: userId }, data: { s3Prefix } });
    return { s3Prefix, cloudfrontDomain: user.cloudfrontDomain, cloudfrontDistId: user.cloudfrontDistId };
  }
  // Crear la distribución del cliente (dominio propio, descartable).
  const dist = await createClientDistribution(s3Prefix);
  if (!dist) return null;
  await prisma.user.update({
    where: { id: userId },
    data: { s3Prefix, cloudfrontDomain: dist.domain, cloudfrontDistId: dist.distId },
  });
  return { s3Prefix, cloudfrontDomain: dist.domain, cloudfrontDistId: dist.distId };
}

// Reprovisiona el dominio del cliente: crea una distribución NUEVA (dominio nuevo) apuntando
// a la misma carpeta S3, y actualiza el user + las URLs de sus landings publicadas. Para
// cuando Meta quema el dominio actual: el cliente salta a uno limpio sin tocar a los demás.
export async function reprovisionClientDomain(userId: string): Promise<ClientCdn | null> {
  if (!s3Enabled() || !BUCKET) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { slug: true, s3Prefix: true } });
  if (!user) return null;
  const s3Prefix = user.s3Prefix ?? user.slug;
  const dist = await createClientDistribution(s3Prefix);
  if (!dist) return null;
  await prisma.user.update({
    where: { id: userId },
    data: { s3Prefix, cloudfrontDomain: dist.domain, cloudfrontDistId: dist.distId },
  });
  // Reapuntar las landings publicadas al dominio nuevo (el HTML en S3 no cambia).
  const landings = await prisma.landing.findMany({ where: { userId, published: true }, select: { id: true, slug: true } });
  for (const l of landings) {
    await prisma.landing.update({
      where: { id: l.id },
      data: { publishedUrl: `https://${dist.domain}/${l.slug}/index.html` },
    });
  }
  return { s3Prefix, cloudfrontDomain: dist.domain, cloudfrontDistId: dist.distId };
}

// Invalida el cache de la distribución (tras re-publicar una landing). Best-effort.
export async function invalidate(distId: string, paths: string[] = ["/*"]): Promise<void> {
  if (!s3Enabled() || !distId) return;
  try {
    const { m, client } = await cfClient();
    await client.send(
      new m.CreateInvalidationCommand({
        DistributionId: distId,
        InvalidationBatch: {
          CallerReference: `inv-${Date.now()}`,
          Paths: { Quantity: paths.length, Items: paths },
        },
      }),
    );
  } catch (e) {
    console.warn("[cloudfront] invalidación falló:", e instanceof Error ? e.message : String(e));
  }
}
