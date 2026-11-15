# Step 24: one image for both Builder API services; ROLE picks which one a container runs
# (api: uploads, UI, status, live preview; orchestrator: builds projects). Build from the repo root:
#   docker compose -f deploy/docker-compose.yml build
FROM node:22-bookworm-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 LOG_FORMAT=json
WORKDIR /app/builder-api
COPY builder-api/package.json builder-api/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY builder-api/src ./src
COPY shared /app/shared
COPY templates /app/templates
COPY --from=web /app/web/dist /app/web/dist
# Step 33c: the verifier service starts sandboxes through the Docker socket it is given (only it gets one):
# the Docker CLI (static), and the few files the sandbox image is built from (SANDBOX_CONTEXT).
COPY --from=docker:28.5.2-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:28.5.2-cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
COPY deploy/sandbox /app/sandbox-context/deploy/sandbox
COPY builder-api/src/verify/run-app.mjs /app/sandbox-context/builder-api/src/verify/run-app.mjs
ENV SANDBOX_CONTEXT=/app/sandbox-context
# runs/ (projects, generated apps, blobs) is a volume shared by both services
RUN mkdir -p /app/runs && chown -R node:node /app/runs
USER node
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/readyz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/server.js"]
