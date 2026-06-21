# Imagen de producción de Publi.lat: backend (API + Socket.IO) que además sirve el
# panel (build de Vite) -> un solo servicio. Es un npm workspace (lockfile en la raíz).

# 1) Build: instala el workspace completo y buildea panel + backend.
FROM node:20-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Sólo los manifests primero, para cachear npm ci.
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
# Código y build.
COPY . .
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build --workspace frontend
RUN npx prisma generate --schema backend/prisma/schema.prisma \
 && npm run build --workspace backend

# 2) Runtime: Node slim con node_modules + dist + prisma + panel buildeado.
FROM node:20-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/frontend/dist ./frontend/dist
ENV FRONTEND_DIST=/app/frontend/dist
WORKDIR /app/backend
EXPOSE 4000
# Aplica migraciones y arranca. (Para varias réplicas, mover migrate deploy a un job aparte.)
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/index.js"]
