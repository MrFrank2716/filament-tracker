# The Wrkbench bridge: one small program that reads the printers on its network and reports to Wrkbench.
# Build from the repository root:  docker build -f bridge/Dockerfile -t wrkbench-bridge .
FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY protocol/package.json protocol/
COPY bridge/package.json bridge/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace bridge --workspace protocol --include-workspace-root
COPY protocol protocol
COPY bridge bridge
# Everything the bridge needs, bundled into one file.
RUN npm run build -w bridge

FROM node:22-slim
ENV NODE_ENV=production \
    WRKBENCH_BRIDGE_DIR=/data
# Its settings, token and the printers' access codes live here: mount a volume so they survive an update.
RUN mkdir /data && chown node:node /data
VOLUME /data
COPY --from=build /src/bridge/dist/cli.cjs /app/cli.cjs
USER node
ENTRYPOINT ["node", "/app/cli.cjs"]
