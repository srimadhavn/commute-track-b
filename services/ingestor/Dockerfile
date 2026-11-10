
# Stage 1: Build
FROM node:22-alpine AS build

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/commute-core/package.json packages/commute-core/
COPY services/api/package.json services/api/
COPY services/ingestor/package.json services/ingestor/

RUN npm ci --omit=dev --workspace services/ingestor

COPY services/ingestor services/ingestor

# Stage 2: Runtime
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/bin/npm \
    /usr/local/bin/npx

COPY --from=build --chown=node:node /app /app

USER node
EXPOSE 9101

CMD ["node", "services/ingestor/src/index.mjs"]
