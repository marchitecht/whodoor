# ---- build: install workspace, build client + server, pack prod deps ----
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile
COPY packages packages
ARG BASE_PATH=/games/whodoor/
ENV BASE_PATH=$BASE_PATH
RUN pnpm build && pnpm --filter @whodoor/server deploy --prod --legacy /out

# ---- runtime: server bundle + client static + prod node_modules ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 STATIC_DIR=/app/public
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/packages/server/dist ./dist
COPY --from=build /app/packages/client/dist ./public
RUN echo '{"type":"module"}' > package.json
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "dist/index.js"]
