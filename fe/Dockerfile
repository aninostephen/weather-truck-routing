# Stage 1: Build the React + TypeScript + Vite static bundle
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

ARG VITE_MAPBOX_ACCESS_TOKEN
ARG VITE_MAPBOX_STYLE_URL
ARG VITE_API_BASE_URL=/api

# If build args are omitted, unset empty placeholders so Vite can fall back to fe/.env;
# always default VITE_API_BASE_URL to /api so Nginx proxies /api/* to the backend container.
RUN if [ -z "$VITE_MAPBOX_ACCESS_TOKEN" ]; then unset VITE_MAPBOX_ACCESS_TOKEN; fi \
 && if [ -z "$VITE_MAPBOX_STYLE_URL" ]; then unset VITE_MAPBOX_STYLE_URL; fi \
 && export VITE_API_BASE_URL="${VITE_API_BASE_URL:-/api}" \
 && npm run build

# Stage 2: Serve static bundle & reverse-proxy /api/* via Nginx
FROM nginx:stable-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

