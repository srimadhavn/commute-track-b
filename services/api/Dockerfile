FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# Dependency layer: only manifests, so it is cached until dependencies change.
COPY package.json package-lock.json ./
COPY packages/commute-core/package.json packages/commute-core/
COPY services/api/package.json services/api/
COPY services/ingestor/package.json services/ingestor/
RUN npm ci --omit=dev --workspace services/api && npm cache clean --force

COPY packages/commute-core packages/commute-core
COPY services/api services/api

USER node
EXPOSE 3000
CMD ["node", "services/api/src/index.mjs"]
