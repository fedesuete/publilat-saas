# Experimento 463 — Planilla de registro (frío/caliente · WEBJS vs NOWEB vs Evolution)

Objetivo: decidir con datos si migrar de Evolution a WAHA. La prueba vale SOLO si es controlada.

## Reglas para que la prueba no mienta
- **Chips NUEVOS y equivalentes** (nunca los quemados fortune/Luckysoft — esa tanda está
  restringida a nivel dispositivo vinculado y da 463 con CUALQUIER motor). Idealmente 3 chips
  comprados juntos, misma operadora/país. Si usás 1 solo chip rotándolo entre sistemas, hacelo el
  **mismo día** y esperá unos minutos entre pruebas.
- **Ojo con el chip recién estrenado**: el PRIMER mensaje de un número nuevo a alguien que no lo
  conoce también lo filtra el **antispam clásico** (independiente del tctoken) y contamina el
  diagnóstico (nos pasó en el incidente fortune). Ideal: que cada chip pase 1–2 días respondiendo
  entrantes antes de la corrida; si no hay tiempo, corré el caliente primero y anotalo.
- **Mismos destinos** en las 3 corridas: un número **caliente** (que ya le escribió a esa línea)
  y un número **frío** (que NUNCA habló con esa línea ni la tiene agendada). Tené el teléfono
  destino a mano para confirmar recepción real (no te fíes solo del panel).
- **Mismo texto**, mismo momento del día.
- Registrar el **ack real** (lo que muestra la burbuja/el log: entregado ✓✓ / rojo ERROR / nada).
- Regla de lectura: `201` / `{"ok":true}` = **aceptado, NO entregado**. La verdad está en el ack
  y en el teléfono destino.

## Corridas
Para cada sistema conectá el chip, esperá a que quede `open`/`WORKING`, y hacé los 2 envíos.

| # | Sistema | Engine | Chip (últimos 4) | Destino | Frío/Caliente | Ack en panel/log | ¿Llegó al destino? | Código/Nota |
|---|---------|--------|------------------|---------|---------------|------------------|--------------------|-------------|
| 1 | Evolution | Baileys(fork) | ____ | ____ | Caliente | | | |
| 2 | Evolution | Baileys(fork) | ____ | ____ | Frío | | | (¿463 acá?) |
| 3 | WAHA | WEBJS | ____ | ____ | Caliente | | | |
| 4 | WAHA | WEBJS | ____ | ____ | Frío | | | ← el dato clave |
| 5 | WAHA | NOWEB | ____ | ____ | Caliente | | | |
| 6 | WAHA | NOWEB | ____ | ____ | Frío | | | |

> Para cambiar de engine en WAHA: editá `WAHA_ENGINE` en el `.env`, `docker compose -f
> docker-compose.waha.yml up -d` (recrea el contenedor) y reiniciá el backend de prueba.
> Confirmá el engine activo en el dashboard `:3001/dashboard` antes de cada corrida.

## Cómo ejecutar cada envío (lo operativo)

**El frío NO se puede mandar desde el Inbox de Publi**: el Inbox solo deja escribirle a
contactos que ya escribieron ("El contacto aún no tiene teléfono"). El frío va por **API
directa al motor**; el caliente conviene hacerlo desde el Inbox (así ves la burbuja/tildes
de una) o por API.

**Evolution (corridas 1–2)** — desde el VPS (`INSTANCIA` = `line_<id>`, `DESTINO` = 5959…
sin `+`):

```bash
# Enviar:
docker exec publilat-app-1 node -e 'fetch("http://evolution:8080/message/sendText/INSTANCIA",{method:"POST",headers:{apikey:process.env.EVOLUTION_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({number:"DESTINO",text:"TEXTO"})}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d)))'

# Ack real / 463 — el código de stub aparece en el LOG de Evolution (no llega al webhook):
docker logs --since 10m publilat-evolution-1 2>&1 | grep -iE "463|messageStub|ERROR" | tail -5
```

**WAHA (corridas 3–6)** — en la instancia de prueba:

```bash
# Enviar:
curl -s -X POST http://localhost:3001/api/sendText \
  -H "X-Api-Key: $WAHA_API_KEY" -H "Content-Type: application/json" \
  -d '{"session":"line_test","chatId":"DESTINO@c.us","text":"TEXTO"}'

# Ack real: burbuja del Inbox del backend de prueba (WA_ENGINE=waha) o el log de WAHA:
docker logs --since 10m $(docker ps --format '{{.Names}}' | grep waha) 2>&1 | grep -iE "ack|error" | tail -10
```

## Lectura del resultado
- **Fila 4 (WEBJS frío) LLEGÓ y fila 2 (Evolution frío) dio 463** → **migramos a WAHA WEBJS.**
  Es la evidencia que buscamos.
- **WEBJS frío llegó pero NOWEB frío (fila 6) no** → WEBJS es el camino (Chromium real manda el
  tctoken); NOWEB no alcanza.
- **Ningún frío llegó en ninguno** → el problema NO es el motor: es **IP/número**. La respuesta es
  el **proxy residencial por línea** (campo ya listo) + **calentamiento** (ya activo). Reprobá
  cargando un proxy residencial del país del número en la línea de prueba.
- **El caliente llega en todos** (esperado) → confirma que el chip y el envío están sanos; el 463
  es específico del frío.

## Después
Traé la tabla llena y cerramos el veredicto + el plan de migración (o de proxies). Recordá: si
WAHA gana, hay que resolver **media** (WAHA Core no la maneja → WAHA Plus) antes de migrar
producción; para la decisión del 463 con texto no hace falta.
