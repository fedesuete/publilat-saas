# INSTALL — Stack completo de Publi.lat (Windows)

Instalás todo una vez y queda listo para todo el proyecto. Igual al stack de ScaleOS:
Node + Postgres + Redis + Evolution API (WhatsApp).

## 1. Programas a instalar (una sola vez)

| Programa | Para qué | Dónde |
|----------|----------|-------|
| **Node.js 20 LTS** | Correr backend y frontend | nodejs.org → "LTS" |
| **Git** | Control de versiones | git-scm.com |
| **Docker Desktop** | Postgres + Redis + Evolution API en contenedores | docker.com/products/docker-desktop |

> Después de instalar Docker Desktop: **abrilo una vez** y esperá a que diga
> "Engine running". En Windows puede pedir activar WSL2 (seguí el asistente).

Verificá en una terminal NUEVA:
```
node -v      # debe mostrar v20.x o superior
git --version
docker -v
```

## 2. Levantar el stack (Postgres + Redis + Evolution API)

Desde la carpeta `publilat-saas`:
```
docker compose up -d
```
Esto descarga y arranca los 3 servicios. La primera vez tarda unos minutos.
Comprobá que estén arriba:
```
docker compose ps
```
- Postgres → localhost:5432  (crea las bases `publilat` y `evolution`)
- Redis → localhost:6379
- Evolution API → http://localhost:8080

## 3. Configurar el .env

```
copy .env.example .env
```
En el `.env`, para desarrollo local ya queda casi todo bien. Revisá:
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/publilat?schema=public`
- `EVOLUTION_API_URL=http://localhost:8080`
- `EVOLUTION_API_KEY=publilat-dev-key-cambiame`  (la MISMA que está en docker-compose.yml)
- `META_PIXEL_ID=` y `META_CAPI_TOKEN=`  → completá con tus datos de Meta

## 4. Backend

```
cd backend
npm install
npx prisma migrate dev --name init
npm run dev
```
Probar: abrir http://localhost:4000/health → debe responder `{"ok":true}`.

## 5. Frontend (otra terminal)

```
cd frontend
npm install
npm run dev
```
Panel en http://localhost:5173

## 6. Arrancar Claude Code

Abrí `KICKOFF.md`, copiá el bloque de prompt y pegalo en el chat de Claude Code
para construir la Fase 1 (loop de atribución).

---

### Comandos útiles de Docker
```
docker compose up -d        # levantar todo
docker compose ps           # ver estado
docker compose logs -f evolution-api   # ver logs de WhatsApp
docker compose down         # apagar (los datos quedan guardados)
```
