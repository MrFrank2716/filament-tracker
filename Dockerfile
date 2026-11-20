# One image: the API serves the built client, so a single container is the whole app.
FROM node:22-slim

# Prisma's query engine needs OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install first, from the manifests only, so this layer is reused until dependencies change.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY protocol/package.json protocol/
COPY bridge/package.json bridge/
# The bridge is a separate program with its own image (bridge/Dockerfile): its dependencies stay out of this one.
RUN npm ci --workspace server --workspace client --workspace protocol --include-workspace-root

COPY . .
# Generates the Prisma client, typechecks, and builds the client into client/dist.
RUN npm run build

# Everything that must survive a redeploy lives under /data: mount a persistent volume there.
ENV NODE_ENV=production \
    PORT=4000 \
    TRUST_PROXY=1 \
    DATABASE_URL=file:/data/app.db \
    UPLOAD_DIR=/data/uploads

EXPOSE 4000

# Keep a copy of the database if an update is about to change it (and put a backup back, if asked), bring it up
# to date, then start. JWT_SECRET and CLIENT_ORIGIN come from the host.
CMD ["sh", "-c", "npm run db:prepare && npm run db:deploy && npm start"]
