# Informe — Error 463 / device_removed: ScaleOS vs Publi.lat

**Modo:** solo lectura / análisis. No se modificó código, repo, VPS ni base. Las acciones sobre
ScaleOS y WhatsApp las ejecuta el usuario; acá se documenta la evidencia y el protocolo.

---

## Resumen ejecutivo (lo más importante primero)

La hipótesis del brief (proxies residenciales / warming / números calientes) es **secundaria**.
La causa raíz del **error 463 ("NackCallerReachoutTimelocked" / Reachout Timelock)** está
**documentada y es técnica del motor**:

> WhatsApp exige que los mensajes salientes a **contactos "fríos"** (que nunca te escribieron)
> incluyan los campos de privacidad **`tctoken` / `cstoken`**. El cliente oficial los manda; las
> versiones de **Baileys** que NO los incluyen (o reciclan tokens vencidos) hacen que el servidor
> de WhatsApp cuente el envío como "reaching out" y aplique el **time-lock 463**.

El fix está en Baileys en los PRs **#2257, #2339 y #2438** (incluir y reciclar tctoken/cstoken,
imitando al cliente oficial). Es decir: **el que "no sufre 463" corre un motor que ya trae ese fix;
el que lo sufre corre una versión sin él.** No es (principalmente) magia de proxy.

**Traducción a tu caso:** Publi corre **Evolution API 2.4**, que usa un **fork propio de Baileys**
(`evolution-api-baileys`). Si ese fork no mergeó el fix de tctoken/cstoken, vas a tener 463 en
fríos con números nuevos — exactamente tu síntoma. ScaleOS casi seguro corre un motor/versión que
sí lo trae (o WAHA/otro engine actualizado).

---

## Evidencia recogida (Fase 2 — red del panel de ScaleOS, sobre la cuenta del usuario)

Observado en DevTools/Network navegando `scaleplayllc.com/portal/numeros` (sesión propia):
- Endpoint **`/api/portal/wa-sessions`** → modelo de **sesiones de WhatsApp Web** (familia Baileys).
- Múltiples **sesiones/instancias por número**, con nombres tipo **`cli72_1781926185339`**
  (cliente+timestamp = patrón de manager de instancias) y estados **"Conectado" / "offline"**.
- Flujo **"Nueva conexión WA"** (alta por escaneo → linked device).
- **Cero llamadas a `graph.facebook.com`** → **NO usan Cloud API oficial**.
- Transporte en tiempo real por **Socket.IO** (polling), igual que Publi.
- Varias sesiones figuran **"offline"** → **a ScaleOS también se le caen sesiones** (normal en Baileys;
  no es infalible). Esto ya descarta que tengan un motor mágicamente estable.

**Conclusión Fase 2:** ScaleOS = WhatsApp **no oficial basado en sesiones (Baileys/family)**, igual
categoría que tu Evolution. La diferencia está en la **versión del motor** y/o en la **capa de red
(proxy)**, no en usar algo oficial.

## Arquitectura de Publi.lat (leído del repo, solo lectura)

`backend/src/lib/evolution.ts` + `docker-compose.yml`:
- **Evolution API v2**, integración `WHATSAPP-BAILEYS` (motor Baileys).
- Alta por **QR** y también **pairing code** (`connectInstance` con `number` → pairingCode) — ya lo tenés.
- Webhook con `MESSAGES_UPDATE` → **capturás los acks de entrega** (por eso ves el 463 real y no un
  falso "enviado").
- **Sin proxy**: se conecta desde la **IP del VPS** directamente (no hay config de proxy por línea).
- **Sin warming / sin límites por línea** en el código.
- `CONFIG_SESSION_PHONE_VERSION` pineado en el compose (versión de WhatsApp Web).

---

## Tabla comparativa

| Dimensión | ScaleOS | Publi.lat |
|---|---|---|
| Tipo de conexión | No oficial, linked device (sesiones) | No oficial, linked device (Evolution/Baileys) |
| Motor | Baileys/family (endpoint `wa-sessions`) | Evolution API 2.4 (fork Baileys) |
| Cloud API oficial | No (cero `graph.facebook.com`) | No (para líneas de casino) |
| Proxy por número | **A confirmar (Fase 3)** | **No** (IP del VPS) |
| Warming / límites | A confirmar (Fase 2 UI) | No |
| Acks de entrega | Sí (muestra estados) | Sí (`MESSAGES_UPDATE`) |
| Pairing code | A confirmar | Sí (soportado) |
| Fix tctoken/cstoken (463) | Probable (por eso "no pasa") | **A verificar en su fork** |
| Sesiones caídas | Sí (varias "offline") | Sí (device_removed) |

---

## Protocolo para vos (Fases 1 y 3 — las ejecutás a mano)

### FASE 1 — Huella del dispositivo vinculado (10 min)
1. Conectá una línea en **ScaleOS**. Apenas vincule, en el teléfono andá a
   **WhatsApp → Dispositivos vinculados** y anotá **cómo se identifica la sesión**:
   ej. "Google Chrome (Linux)", "WhatsApp Web", un nombre custom, etc. Sacá captura.
2. Hacé lo mismo con una línea en **Publi.lat** y compará el texto exacto.
   - Si ambas dicen algo tipo **"Chrome (Linux)"** → las dos son Baileys (spoofean navegador).
   - Si ScaleOS dice **"Google Chrome (Windows/Mac)"** con versión real → podrían usar
     **whatsapp-web.js** (Chromium real) en vez de Baileys.
   - Si **NO aparece** como dispositivo vinculado → sería Cloud API (ya sabemos que no).
3. Anotá si ScaleOS ofrece **pairing code** además de QR.

### FASE 3 — Experimento controlado 463 (el corazón)
Mismo día, mismos destinos, **números equivalentes** (dos chips NUEVOS, no uno viejo caliente):
- **Chip A → ScaleOS.** Enviar: (i) respuesta a un chat que el otro inició [caliente],
  (ii) primer mensaje a un número que nunca habló con esa línea [frío]. Confirmar recepción en el
  teléfono destino.
- **Chip B → Publi.lat** (como usuario normal). Repetir EXACTO lo mismo.
- Registrar en una tabla: qué entrega y qué no, en cuál sistema, y qué muestra cada panel
  (¿ScaleOS oculta el fallo o el frío realmente llega?).

**Interpretación:**
- Frío llega en ScaleOS y da 463 en Publi con números equivalentes el mismo día → **tienen algo
  real** (motor con fix tctoken, o proxy). Ahí sí vale invertir en cambiarlo.
- Si en los dos pasa lo mismo → era **sesgo de números** (los tuyos venían quemados), no software.

---

## Cambios RECOMENDADOS (NO ejecutar — decidir en otra sesión)

Priorizados por impacto/esfuerzo:

1. **[Alto impacto / medio esfuerzo] Actualizar el motor a uno con el fix tctoken/cstoken.**
   Opciones: última Evolution/`evolution-api-baileys` que haya mergeado los PRs #2257/#2339/#2438,
   o migrar el engine a **WAHA Plus** (motores NOWEB/actualizados) o **Baileys oficial al día**.
   Es el candidato #1 para matar el 463 en fríos.
2. **[Alto / alto] Proxy residencial por número, del país del número.** Reduce el peso de "IP de
   datacenter compartida" (señal de spam). Costo recurrente por proxy.
3. **[Medio / medio] Rampa de volumen (warming) automática por línea nueva.** Límite diario que
   crece (día 1 bajo, factor de crecimiento). Baja bans y 463 en números nuevos.
4. **[Medio / bajo] Preferir pairing code y números "calientes"** (con historial) al onboardear.
5. **[Bajo / bajo] Middleware anti-ban** (tipo `baileys-antiban`): detecta 463, frena fríos durante
   el time-lock, deja pasar calientes/grupos, reintenta al expirar. Mitiga aunque el motor no tenga
   el fix.
6. **[Transversal] Salud de línea + reconexión + persistencia de sesión** (para device_removed):
   reconexión automática, persistencia en DB (ya tenés `DATABASE_ENABLED=true`), y versión de
   WhatsApp Web al día en `CONFIG_SESSION_PHONE_VERSION`.

---

## Veredicto (preliminar, a confirmar con Fase 3)

Lo que más probablemente explica que "en ScaleOS no pasa" **no es un motor oficial ni magia**: es
que **corren una versión del motor que incluye el fix de `tctoken/cstoken`** (y, muy posiblemente,
**proxies + rampa de volumen** encima). Ambos usan Baileys/family y a ambos se les caen sesiones.
El experimento de la Fase 3 con números equivalentes el mismo día es lo que confirma si la ventaja
es real (motor/proxy) o si era sesgo de números quemados.

**Próximo paso:** ejecutá Fase 1 (huella) y Fase 3 (frío/caliente) y traé los resultados; con eso
cierro el veredicto y priorizamos los cambios para la sesión de implementación.
