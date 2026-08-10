# HANDOFF — Tu gateway Baileys está expuesto al error 463 (tctoken) y hoy no lo verías

> De: Publi.lat (Federico) · Para: Lucky Soft
> Fecha: 2026-07-06
> Contexto: leímos tu handoff del gateway self-hosted (server.js + Baileys 6.7.21). Está muy bien armado — esto no es una crítica al diseño, es un aviso puntual de protocolo de WhatsApp que nosotros pagamos caro (incidente fortune 03–04/07) y que a tu versión de Baileys le falta. Va con diagnóstico, prueba de 10 minutos y parche.

---

## 0. Resumen en 30 segundos

- Tu gateway usa `@whiskeysockets/baileys ^6.7.21`. Esa versión **NO envía el tctoken** (el "privacy token" que WhatsApp exige en cada DM saliente desde mediados de 2026).
- Sin tctoken, WhatsApp aplica el **"Reachout Timelock"**: rechaza el envío con **error 463** — de forma **silenciosa**. Tu `/send/text` devuelve `{"ok":true}` igual, porque WhatsApp *acepta* el mensaje y lo rechaza después, en el ack.
- Hoy no te pega porque tu operación responde chats **calientes** (conversaciones ya establecidas). El riesgo es el **primer contacto / números fríos / campañas salientes**: ahí el mensaje muere y nadie se entera.
- El soporte de tctoken llegó a Baileys recién en **v7.0.0-rc10 (mayo 2026)** — tu 6.7.21 es de noviembre 2025. v7 sigue en RC.
- Bonus: tu server no reenvía los **acks** (`messages.update`), así que un 463 es literalmente invisible en tu stack. Abajo va un parche de ~25 líneas.

---

## 1. Qué es el 463 (lo que aprendimos a los golpes)

- WhatsApp exige adjuntar un **tctoken** (Trusted Contact token) en los mensajes 1-a-1 salientes. Si falta o está vencido, el servidor lo cuenta como "reach-out" y aplica un rate-limit/rechazo: el ack vuelve como `{ status: 0, messageStubParameters: ["463"] }`.
- **Aceptado ≠ entregado.** El request de envío responde OK (en tu caso `{"ok":true}`, en Evolution HTTP 201). El rechazo llega después por el evento `messages.update`, que tu server hoy no escucha.
- El cliente oficial del teléfono SIEMPRE manda tctoken → por eso "desde el celular llega y desde el sistema no" es la firma clásica de este problema.
- Nosotros lo sufrimos con Evolution v2.3.7 (que traía un Baileys viejo, como tu 6.7.21): recibir perfecto, enviar a chats establecidos OK, enviar a pares fríos → 463. Se resolvió subiendo a un motor con tctoken (Evolution 2.4). Verificado con DELIVERY_ACK el 04/07.

Referencias (por si quieren el detalle fino):
- Releases de Baileys — v7.0.0-rc10: "Full TC Token issuance, revocation, expiration, pruning lifecycle" + "Reachout Timelock (Your account is restricted - the 463 error)": https://github.com/WhiskeySockets/Baileys/releases
- Investigación del 463: https://github.com/WhiskeySockets/Baileys/issues/2441
- 463 aún reportado en v7 RC (cuentas restringidas): https://github.com/WhiskeySockets/Baileys/issues/2636
- Mismo problema en otro engine sin tctoken (WAHA/GOWS): https://github.com/devlikeapro/waha/issues/1992

---

## 2. Probalo en 10 minutos (sin tocar código)

El sesgo de prueba nos hizo perder un día — seguí este orden:

1. **Test caliente:** desde el CRM, respondé un chat que el OTRO inició. Probablemente entrega ✓. Esto es lo que ya venís probando y por eso todo "parece andar".
2. **Test frío:** enviá a un número al que esa línea **nunca** escribió y que **no** la tiene agendada (usá el chip de alguien de confianza para confirmar recepción). Acá es donde aparece el 463.
3. **Control:** mandá lo mismo al mismo destino desde el **teléfono físico** de la línea. Si el teléfono entrega y el gateway no → es tctoken (o número restringido, ver §5), no es tu código.
4. Regla de lectura: `{"ok":true}` = aceptado, no entregado. La verdad está en el ack (§3).

⚠️ No pruebes primer-contacto desde un número recién estrenado: eso también lo filtra el antispam clásico y contamina el diagnóstico.

---

## 3. Parche: reenviar los acks (hoy el 463 es invisible en tu stack)

Tu server escucha `messages.upsert` pero no **`messages.update`** — el CRM nunca se entera si un saliente fue entregado, leído o **rechazado**. Nosotros teníamos el mismo gap (burbuja verde mintiendo) y lo cerramos esta semana: tildes ✓/✓✓ reales y burbuja roja "No entregado (463)".

**3.1 — En `server.js`, dentro de `createInstance`, junto al handler de `messages.upsert`:**

```javascript
// Acks de salientes (entregado / leído / RECHAZADO 463). Sin esto, un envío
// rechazado por WhatsApp queda como "ok" para siempre.
sock.ev.on('messages.update', async (updates) => {
  const webhook = instance.webhook
  if (!webhook) return
  for (const u of updates) {
    const status = u.update?.status
    if (status === undefined) continue // ediciones/polls: no interesan
    const payload = {
      event: 'messages.update',
      instance: name,
      data: {
        key: u.key, // key.id = el id que devolvió sendMessage
        status,     // 0=ERROR 1=PENDING 2=SERVER_ACK 3=DELIVERY_ACK 4=READ 5=PLAYED
        messageStubParameters: u.update?.messageStubParameters || null, // ["463"] si lo rechazó
      }
    }
    const webhookHeaders = { 'Content-Type': 'application/json' }
    if (WEBHOOK_SECRET) webhookHeaders['x-webhook-secret'] = WEBHOOK_SECRET
    const urls = String(webhook || '').split(',').map(x => x.trim()).filter(Boolean)
    for (const url of urls) {
      try { await fetch(url, { method: 'POST', headers: webhookHeaders, body: JSON.stringify(payload) }) }
      catch (e) { console.error('[' + name + '] Ack webhook error:', e.message) }
    }
  }
})
```

**3.2 — En `/send/text`, devolvé el id del mensaje** (hoy lo descartás; sin el id, el CRM no puede matchear el ack):

```javascript
const sent = await inst.sock.sendMessage(jid, { text: message })
res.json({ ok: true, id: sent?.key?.id || null })
```

**3.3 — En el CRM (Lucky CRM):** guardá ese `id` con el mensaje; cuando llegue `messages.update` con `status: 0` y stub `["463"]`, marcá el mensaje **NO ENTREGADO** (rojo) en el inbox. `status: 3` = entregado ✓✓, `4` = leído. (Los acks llegan duplicados y fuera de orden — uno por dispositivo del receptor — así que solo "avanzá" el estado: sent < delivered < read; failed pisa todo.)

Con tu bind-mount de `server.js` es editar + `docker restart whatsapp-server`. Cero rebuild.

---

## 4. Opciones para el motor

| Opción | Cuándo | Notas |
|---|---|---|
| Quedarte en 6.7.21 + parche de acks + protocolo de prueba | Hoy, si tu operación es 100 % inbound | Respondiendo chats que el cliente inicia, el tctoken casi no te pega. Con los acks al menos VES los rechazos. |
| **Baileys v7.0.0-rc** | Si el 463 te empieza a pegar | tctoken completo (rc10+). Es RC: hay issues abiertos de 463 en cuentas ya restringidas. Probalo en una línea sacrificable antes de migrar todo. Ojo: v7 cambia API (guía: https://baileys.wiki/docs/migration/to-v7.0.0/). |
| Evolution v2.4 (tag homolog) + licencia community | Si preferís motor mantenido | Es lo que corremos nosotros. Trae Baileys con tctoken; verificado entregando con DELIVERY_ACK. La licencia community es gratis (se activa una vez por el Manager y persiste en su DB). |
| Cloud API / coexistencia | Clientes que viven del canal | Entrega garantizada, sin sesiones ni versiones. Coexistencia (global desde nov 2025) deja el número activo en la app del teléfono Y en la API. |

---

## 5. Datos de números que te tocan directo

- **La tanda Luckysoft (…176202256 / …176202258) está restringida a nivel dispositivo-vinculado.** Lo comprobamos con experimento controlado (mismo número, mismo chat, mismo minuto): el teléfono físico entregó (status 3) y el dispositivo vinculado dio 463 — en Evolution 2.4 con tctoken incluido. Es decir: con esos chips, NINGÚN Baileys va a entregar, con o sin tctoken. No gastes horas debuggeando software con esos números: es el número.
- Números nuevos: **calentamiento** — varios días respondiendo inbound antes de iniciar conversaciones. El primer mensaje de un número estrenado a alguien que no lo conoce se filtra silencioso.
- **Tu fallback de versión está vencido.** `server.js` fetchea la versión de WA Web dinámicamente (bien 👍) pero el fallback hardcodeado `[2, 3000, 1034074495]` es ANTERIOR a la `2.3000.1035194821` que venció el 04/07/2026. Si el fetch falla un día y cae al fallback, la línea conecta y recibe pero **los envíos se descartan en silencio** (lo vivimos: fue la primera capa del incidente fortune). Actualizalo cada tanto desde: https://raw.githubusercontent.com/wppconnect-team/wa-version/main/versions.json (campo `currentVersion`, sin sufijo -alpha).

---

## 6. TL;DR accionable

1. Hacé el **test frío** del §2 (10 min) — vas a saber si el 463 ya te está comiendo mensajes.
2. Aplicá el **parche de acks** del §3 (25 líneas + restart) — rechazos visibles en vez de silencio.
3. Actualizá el **fallback de versión** del §5.
4. Decisión de motor (§4) según cuánto saliente-frío tenga tu operación. Para inbound puro, tu 6.7.21 + acks aguanta; para iniciar conversaciones, necesitás tctoken (Baileys v7 / Evolution 2.4) o API oficial.
5. Los chips Luckysoft: jubilarlos para envíos por sistema. Número limpio + calentamiento, o Cloud API.

*Cualquier duda del detalle, tenemos los logs del incidente y el playbook completo documentado de nuestro lado.*
