FROM node:22-alpine AS frontend-build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY frontend ./frontend
COPY public ./public
COPY scripts ./scripts
RUN npm run frontend:build

FROM node:22-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S fides && adduser -S fides -G fides

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY --from=frontend-build /app/public ./public
COPY scripts ./scripts
COPY migrations ./migrations

USER fides
EXPOSE 3000

CMD ["node", "src/server.js"]
