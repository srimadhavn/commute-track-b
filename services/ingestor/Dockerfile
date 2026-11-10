FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/commute-core/package.json packages/commute-core/
COPY services/api/package.json services/api/
COPY services/ingestor/package.json services/ingestor/
RUN npm ci --omit=dev --workspace services/ingestor && npm cache clean --force

COPY services/ingestor services/ingestor

USER node
EXPOSE 9101
CMD ["node", "services/ingestor/src/index.mjs"]
