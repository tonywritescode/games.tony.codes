FROM node:20-alpine AS base
RUN apk add --no-cache dumb-init
WORKDIR /app

# ── Development ──
FROM base AS development
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5173
CMD ["dumb-init", "npm", "run", "dev"]

# ── Production build ──
FROM base AS build
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN echo "{\"status\":\"ok\",\"build\":{\"commit\":\"${GIT_SHA}\",\"time\":\"${BUILD_TIME}\"}}" > dist/health.json

# ── Production serve ──
FROM nginx:alpine AS production
RUN apk add --no-cache curl
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/health.json || exit 1
CMD ["nginx", "-g", "daemon off;"]
