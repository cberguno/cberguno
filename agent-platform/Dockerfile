# syntax=docker/dockerfile:1
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY apps ./apps
RUN pnpm --filter @ap/web build && pnpm --filter @ap/api build \
 && pnpm --filter @ap/api deploy --legacy --prod /out/api

FROM node:22-slim
# Optional: bake in Chromium for the read-only browser_read tool.  docker build --build-arg BROWSER=chromium .
# (empty by default: ${BROWSER:+...} below is only set when the arg is non-empty)
ARG BROWSER=""
RUN if [ -n "$BROWSER" ]; then apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation && rm -rf /var/lib/apt/lists/*; fi
ENV NODE_ENV=production PORT=8080 WEB_DIST=/app/web
ENV BROWSER_EXECUTABLE_PATH=${BROWSER:+/usr/bin/chromium} BROWSER_NO_SANDBOX=${BROWSER:+true}
WORKDIR /app/api
COPY --from=build /out/api/node_modules ./node_modules
COPY --from=build /out/api/dist ./dist
COPY --from=build /out/api/migrations ./migrations
COPY --from=build /out/api/package.json ./package.json
COPY --from=build /app/apps/web/dist /app/web
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
