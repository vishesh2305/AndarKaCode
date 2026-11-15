# Step 33a: the sandbox a generated app runs in (builder-api/src/verify/sandbox.js): MongoDB 8 for the
# app's own database, Node 22, and the packages generated apps use (Express, Mongoose) in /node_modules,
# where Node finds them from /app. No npm at run time, no keys, nothing of ours but the three small
# scripts in /runner. Build from the repo root (the Builder API does this itself: buildSandboxImage()):
#   docker build -t andarkacode/sandbox -f deploy/sandbox/Dockerfile .
FROM node:22-bookworm-slim AS node

FROM node:22-bookworm-slim AS packages
WORKDIR /p
COPY deploy/sandbox/package.json deploy/sandbox/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM mongo:8
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=packages /p/node_modules /node_modules
COPY deploy/sandbox/keeper.mjs deploy/sandbox/door.mjs builder-api/src/verify/run-app.mjs /runner/
ENTRYPOINT []
USER 1000:1000
WORKDIR /app
CMD ["node", "/runner/keeper.mjs"]
