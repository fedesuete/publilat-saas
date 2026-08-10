# Prompt para tu Claude (socio / Eduardo) — estrategia de carga/descarga automática + gestión de usuarios

> Copiá TODO esto y pegáselo a tu Claude. Es un mapa exacto de lo que ya construimos del lado de
> **Publi.lat (Chat App)** para operar el casino **ganamos** sin WhatsApp. Al final están las
> preguntas concretas que necesito que me respondas para cerrar la automatización.

---

## 1. Qué es y cómo está armado (nuestro lado)

**Publi.lat Chat App** = un canal propio jugador↔cajero (PWA `chat.publi.lat` + panel del operador),
**fuera de WhatsApp** (WhatsApp banea apuestas). White-label por cuenta (marca/colores/textos). El
jugador se registra, chatea, y **carga/retira plata self-service**. Stack: Node+TypeScript+Express,
PostgreSQL+Prisma, Socket.IO, React. Todo el módulo casino es **aislado y aditivo**.

Moneda: **ARS entero** (sin centavos) en todo el circuito de fichas.

---

## 2. Lo que YA está construido y LIVE

### A) Alta y gestión de jugadores (nuestro lado)
- **Registro un-tap** (`/api/chat/register` con `autogenerate:true`): el server genera
  `casinoUsername` (apodo+dígitos) + clave de 6 dígitos, los guarda y se los muestra al jugador.
- **Registro clásico** (username elegido, passwordless), **entrada abierta** por slug
  (`/api/chat/start`), **login** usuario+clave (`/api/chat/login`), **chat directo** sin registro
  (`/api/chat/direct`, jugador anónimo `web######`), y **link single-use** (`/i/:code`, `InviteCode`).
- Modelo `ChatPlayer` (`casinoUsername` único por cuenta, `password?` bcrypt, `nombre?`).
- Al registrarse dispara **CompleteRegistration** a Meta (CAPI + Pixel), con `external_id = usuario`.
- ⚠️ **El `casinoUsername` hoy se genera y guarda SOLO en NUESTRA base.** No lo estamos creando en
  ganamos todavía (ver preguntas §5).

### B) Cajero self-service (Fase E) — LIVE
- **Jugador carga** (`POST /me/deposit`): informa monto + método + (opcional) foto del comprobante.
  Queda `ChatDeposit` en estado **`pending`**. **NO acredita nada.** Carga mínima configurable.
- **Jugador retira** (`POST /me/withdrawal`): monto + destino (CBU/CVU/alias). Chequea que el
  `ChatWallet` tenga saldo. Queda `ChatWithdrawal` en **`requested`**. Retiro mínimo configurable.
- **Operador aprueba/rechaza** en la sección "Cajero" del panel:
  - Aprobar carga → **suma al `ChatWallet`** + marca `credited` + dispara **Purchase CAPI**
    (idempotente). Único camino MANUAL de acreditación.
  - Aprobar retiro → **débito atómico** del wallet (solo si el saldo alcanza, sin negativos) → `paid`.
- Modelos: `ChatWallet` (saldo por jugador), `ChatDeposit`, `ChatWithdrawal`.

### C) Cliente de la partner-api de ganamos — **CONSTRUIDO pero NO CABLEADO**
Archivo `lib/casino-partner.ts`. Cliente sincrónico, **detrás de flag** (`CASINO_API_URL` +
`CASINO_API_KEY`; sin config = deshabilitado). Lo que asumimos del contrato de ganamos:
- `POST /api/partner/v1/credit`  body `{ usuario, monto, referencia }` → acredita fichas.
- `POST /api/partner/v1/debit`   body `{ usuario, monto, referencia }` → debita fichas.
- `GET  /api/partner/v1/balance` query `{ usuario }` → saldo.
- Auth: header `Authorization: Bearer <CASINO_API_KEY>`.
- **Idempotencia:** mandamos `referencia` en el body Y como header `Idempotency-Key`.
- Respuesta OK esperada: `{ ok:true, status:"completed"|"pending", txId, saldo, referencia, repetido }`.
- Error esperado: `{ ok:false, error:{ code, message } }`. Reintentables:
  `insufficient_cashier_balance` / `rate_limited` / `platform_unavailable` + HTTP 429/503 + red.
- Modelo `CasinoTx` con `referencia @unique` = **idempotency key end-to-end** (type credit|debit,
  usuario, amount, status pending|completed|failed|reversed, txId).
- 🔴 **`casino-partner.ts` NO está importado en ningún lado.** Está listo pero **falta el eslabón**
  que lo llame al momento de acreditar/debitar (hoy la aprobación del operador solo mueve NUESTRO
  wallet local, no toca ganamos).

### D) Purchase CAPI (loop de marketing con Meta) — LIVE
- El **Purchase a Meta** (señal de marketing, NO da fichas) se dispara al **leer el comprobante con
  IA** cuando confirma pago real, y/o al aprobar la carga. Idempotente por carga (`purchaseFiredAt`)
  y por contacto. **Mandar Purchase ≠ acreditar fichas** — son cosas distintas.

### E) Bot de carga/descarga — LIVE (semi-automático)
- `lib/chat-bot.ts`: menú Cargar/Retirar/Cajero, pide monto + datos, y **avisa al cajero** para que
  verifique/acredite. **No acredita solo.** No está conectado al partner-api todavía.

### F) Gateway de cobro automático — **PREPARADO pero APAGADO**
- `POST /api/chat/pay/webhook`: es el **único camino de acreditación AUTOMÁTICA seguro**. Idea: la
  **recaudadora** confirma un pago real (webhook firmado HMAC) → buscamos el `ChatDeposit` por
  `gatewayRef` → lo pasamos a credited → acreditamos wallet → disparamos Purchase. **Devuelve 501
  hoy** (faltan claves + implementar la validación de firma).

---

## 3. La arquitectura objetivo (a dónde queremos llegar)

```
Jugador paga  →  RECAUDADORA (entra la plata, webhook firmado)
                      │
                      ▼
              partner-api ganamos  →  acredita FICHAS al usuario (casinoCredit)
                      │
                      ▼
                  el bot / la app confirman al jugador (saldo actualizado)
```
Todo idempotente por `referencia`. Misma lógica para el retiro al revés (debit + payout).

---

## 4. Reglas duras (no se tocan)

1. Casino **nunca** por WhatsApp Cloud API oficial (banea). El Chat App existe para operar sin WhatsApp.
2. **Nunca acreditar fichas por la imagen del comprobante sola** (fraude). Fichas SOLO por: (a)
   operador aprobando, o (b) webhook de gateway REAL confirmado. (El Purchase a Meta sí se manda al
   leer el comprobante, porque es marketing, no fichas.)
3. Idempotencia end-to-end por `referencia` (`CasinoTx.referencia @unique` + `Idempotency-Key`).
4. ARS entero, sin centavos.

---

## 5. Lo que necesito de TU lado (Eduardo) para cerrar la automatización

**Sobre la partner-api de ganamos:**
1. ¿El contrato real coincide con lo que asumimos (§2.C)? Pasame los **endpoints exactos, auth,
   request/response y códigos de error** reales de `/credit`, `/debit`, `/balance`.
2. ¿`/credit` es **sincrónico** (acredita en la misma llamada) o **asincrónico** (pending + callback)?
3. ¿La `referencia` la deduplica ganamos a nivel DB (para que un timeout que igual acreditó no
   duplique)?

**Sobre la creación/gestión de usuarios:**
4. Cuando un jugador se registra en nuestra app generamos `casinoUsername` local. Para poder cargarle
   fichas, **ese usuario tiene que existir en ganamos**. ¿Cómo se crea un usuario en ganamos? ¿Hay un
   endpoint (`/createUser`?) que podamos llamar al registrar? ¿O `/credit` **auto-crea** el usuario si
   no existe? ¿O el operador tiene que precrearlos?
5. ¿Puede haber colisión de `usuario` entre tenants/marcas en ganamos, o el namespace es por cuenta?

**Sobre el retiro:**
6. En un retiro, ¿ganamos hace `/debit` de las fichas **y además** paga al CBU del jugador, o el débito
   es solo de fichas y **el pago al CBU lo hacemos nosotros** (recaudadora/manual)?

**Sobre la recaudadora (money-in automático):**
7. ¿Cuál es la recaudadora (HG Cash / SmartCobros / Pagopar / otra)? Pasame el **contrato del webhook**:
   firma (HMAC?), campos, cómo casamos el pago con nuestro `ChatDeposit` (`gatewayRef`), y si hay sandbox.

---

## 6. Lo que quiero que me des (la estrategia)

Con todo lo de arriba, dame una **estrategia clara y por fases** para completar:
- **(a) Carga automática:** dinero confirmado → acreditar fichas en ganamos → confirmar al jugador,
  sin que el operador tenga que aprobar a mano (manteniendo la regla dura: solo webhook real o
  operador, nunca la imagen).
- **(b) Descarga automática:** retiro pedido → debitar fichas en ganamos + pagar al jugador, con
  control de saldo y sin dobles pagos.
- **(c) Gestión de usuarios sincronizada:** que el `casinoUsername` de nuestra app y el usuario de
  ganamos sean el mismo, creados en el momento justo, sin colisiones.

Priorizá qué se puede prender YA con lo que hay (el cliente casino-partner + CasinoTx están listos,
solo falta cablearlos) vs qué depende de que me pases claves/contratos. Señalá riesgos (dobles
acreditaciones, usuarios fantasma, timeouts) y cómo los mitiga la idempotencia por `referencia`.
