# Multi-stage build: compile the Vite/React app, then serve the static output with nginx.
#
# VITE_API_URL is baked in at BUILD time (Vite inlines import.meta.env.* into the
# bundle) — pass it via `docker compose build --build-arg` or docker-compose.yml's
# `args:` if the backend URL differs from the default.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
