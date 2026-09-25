// Página para decidir una revisión de soporte desde el mail (link firmado, sin login).
//
// GET  /t/:token  → muestra el caso. Es de SOLO LECTURA a propósito: si un escáner de correo sigue
//                   el enlace, no ejecuta nada.
// POST /t/:token  → aplica la decisión (aprobar/rechazar). Lo dispara el botón de la página.
import { Router } from "express";
import { esc } from "../lib/landing-template.js";
import { prisma } from "../lib/prisma.js";
import { verificarDecision } from "../lib/triage-link.js";

export const triageLinkRouter = Router();

const ACCION_TEXTO: Record<string, string> = {
  ninguna: "no hacer nada (solo responder)",
  responder: "responderle al cliente",
  reiniciar_linea: "reiniciar la línea del cliente",
  guia_qr: "mandarle la guía para reconectar por QR",
  revisar_humano: "que lo mire una persona",
};

function pagina(titulo: string, cuerpo: string, color = "#22c55e"): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(titulo)}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif;background:#0b1220;color:#e2e8f0;min-height:100vh;padding:22px 16px}
.card{max-width:640px;margin:0 auto;background:#111a2e;border:1px solid #1e293b;border-radius:16px;padding:22px}
h1{font-size:19px;margin:0 0 14px;color:${color}}
h2{font-size:12px;letter-spacing:1.3px;text-transform:uppercase;color:#7c8ba1;margin:20px 0 6px;font-weight:700}
p{margin:0 0 10px;line-height:1.55;font-size:14.5px}
.dato{background:#0d1526;border:1px solid #1e293b;border-radius:10px;padding:12px;font-size:14px;white-space:pre-wrap;line-height:1.5}
textarea{width:100%;min-height:150px;background:#0d1526;border:1px solid #294066;border-radius:10px;padding:12px;color:#e2e8f0;font:inherit;font-size:14px;line-height:1.5}
.fila{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}
button{flex:1;min-width:150px;border:0;border-radius:11px;padding:15px;font-size:16px;font-weight:800;cursor:pointer}
.ok{background:#22c55e;color:#04210f}.no{background:#243049;color:#cbd5e1}
.chip{display:inline-block;background:#1e293b;border-radius:999px;padding:4px 11px;font-size:12.5px;color:#a9bcd4;margin-right:6px}
</style></head><body><div class="card">${cuerpo}</div></body></html>`;
}

triageLinkRouter.get("/:token", async (req, res) => {
  const datos = verificarDecision(req.params.token);
  if (!datos) {
    return res.status(400).send(pagina("Link inválido", `<h1>Link inválido o vencido</h1><p>Entrá al panel: Admin → Soporte.</p>`, "#f87171"));
  }
  const t = await prisma.supportTriage.findUnique({ where: { id: datos.triageId } });
  if (!t) return res.status(404).send(pagina("No encontrada", `<h1>La revisión ya no existe</h1>`, "#f87171"));
  const cliente = await prisma.user.findUnique({ where: { id: t.userId }, select: { email: true } });

  if (t.status !== "pending") {
    return res.send(pagina("Ya decidida",
      `<h1>Esta revisión ya fue ${t.status === "rejected" ? "rechazada" : "resuelta"}</h1>
       <p>${esc(t.result ?? "")}</p><p>Cliente: ${esc(cliente?.email ?? "")}</p>`, "#94a3b8"));
  }

  return res.send(pagina("Revisión de soporte", `
    <h1>🤖 Revisión de soporte</h1>
    <p><span class="chip">${esc(cliente?.email ?? "")}</span><span class="chip">confianza ${t.confidence}%</span></p>
    <h2>Qué está pasando</h2><div class="dato">${esc(t.diagnosis)}</div>
    <h2>Qué propone hacer</h2><div class="dato">${esc(ACCION_TEXTO[t.action] ?? t.action)}${t.actionReason ? `\n${esc(t.actionReason)}` : ""}</div>
    <form method="POST" action="/t/${esc(req.params.token)}">
      <h2>Respuesta al cliente (podés editarla)</h2>
      <textarea name="reply">${esc(t.suggestedReply)}</textarea>
      <div class="fila">
        <button class="ok" name="decision" value="approve" type="submit">✓ Aprobar y enviar</button>
        <button class="no" name="decision" value="reject" type="submit">Rechazar</button>
      </div>
    </form>`));
});

triageLinkRouter.post("/:token", async (req, res) => {
  const datos = verificarDecision(req.params.token);
  if (!datos) return res.status(400).send(pagina("Link inválido", `<h1>Link inválido o vencido</h1>`, "#f87171"));

  const decision = String((req.body as { decision?: string })?.decision ?? "") === "reject" ? "reject" : "approve";
  const reply = String((req.body as { reply?: string })?.reply ?? "").slice(0, 4000);

  const { decidirTriage } = await import("../lib/support-triage.js");
  const out = await decidirTriage(datos.triageId, datos.adminId, decision, decision === "approve" ? reply : undefined);
  if (!out.ok) return res.status(out.status).send(pagina("No se pudo", `<h1>${esc(out.error)}</h1>`, "#f87171"));

  // Queda auditado igual que si se hubiera decidido desde el panel (con "desde: mail").
  void prisma.adminLog
    .create({
      data: {
        adminId: datos.adminId,
        action: decision === "approve" ? "support_triage_approve" : "support_triage_reject",
        targetUserId: out.triage.userId,
        meta: { triageId: out.triage.id, desde: "mail", result: out.triage.result ?? null },
      },
    })
    .catch(() => undefined);

  return res.send(pagina(decision === "approve" ? "Aprobado" : "Rechazado",
    decision === "approve"
      ? `<h1>✓ Listo</h1><p>${esc(out.triage.result ?? "Aplicado")}.</p><p>El cliente ya tiene la respuesta en su panel.</p>`
      : `<h1>Rechazada</h1><p>No se hizo nada. Si querés, respondele a mano desde Admin → Soporte.</p>`,
    decision === "approve" ? "#22c55e" : "#94a3b8"));
});
