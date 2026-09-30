# Skola personal: compila la PWA y la sirve junto con la API de mazos suscritos.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:22-alpine
WORKDIR /srv
COPY --from=build /app/dist ./dist
COPY server/server.mjs ./server.mjs
ENV NODE_ENV=production STATIC_DIR=/srv/dist DATA_DIR=/data PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
