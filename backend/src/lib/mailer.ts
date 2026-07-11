// Email transaccional (alertas operativas). Gateado por .env: sin SMTP_HOST es un no-op,
// así dev y las instalaciones sin SMTP siguen funcionando igual (solo notificación in-app).
import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;
let warned = false;

export function mailEnabled(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

function getTransporter(): Transporter | null {
  if (!mailEnabled()) {
    if (!warned) {
      console.log("[mailer] SMTP_HOST no configurado: las alertas por email quedan desactivadas");
      warned = true;
    }
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true", // true = TLS directo (465); false = STARTTLS (587)
      ...(process.env.SMTP_USER
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } }
        : {}),
    });
  }
  return transporter;
}

// Envía un email. Nunca lanza: las alertas no deben tumbar el flujo que las dispara.
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const t = getTransporter();
  if (!t || !to) return false;
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "alertas@publi.lat",
      to,
      subject,
      text,
    });
    return true;
  } catch (e) {
    console.error("[mailer] error enviando a", to, ":", e instanceof Error ? e.message : String(e));
    return false;
  }
}

// Copia al operador de la plataforma (ADMIN_ALERT_EMAIL).
export async function sendAdminMail(subject: string, text: string): Promise<boolean> {
  const admin = process.env.ADMIN_ALERT_EMAIL ?? "";
  if (!admin) return false;
  return sendMail(admin, subject, text);
}
