# Build — producción por defecto; QA: ANGULAR_BUILD_CONFIGURATION=qa + URLs (Coolify build args)
FROM node:20-alpine AS builder
WORKDIR /app

ARG ANGULAR_BUILD_CONFIGURATION=production
ARG QA_API_URL=https://qa-api.baselogic.cl/api
ARG QA_SITE_URL=https://qa.baselogic.cl
ARG QA_VAPID_PUBLIC_KEY=

COPY package*.json ./
RUN npm ci
COPY . .

RUN if [ "$ANGULAR_BUILD_CONFIGURATION" = "qa" ]; then \
      sed -i "s|__QA_API_URL__|${QA_API_URL}|g" src/environments/environment.qa.ts && \
      sed -i "s|__QA_SITE_URL__|${QA_SITE_URL}|g" src/environments/environment.qa.ts && \
      sed -i "s|__QA_VAPID_PUBLIC_KEY__|${QA_VAPID_PUBLIC_KEY}|g" src/environments/environment.qa.ts; \
    fi

RUN npm run build -- --configuration=${ANGULAR_BUILD_CONFIGURATION}

# Nginx sin privilegios (puerto interno 8080; ver nginx.conf)
FROM nginxinc/nginx-unprivileged:stable-alpine
USER root
RUN rm -rf /usr/share/nginx/html/* \
  && apk add --no-cache wget

COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html

# CSR shell → index.html servido por Nginx
RUN cp /usr/share/nginx/html/index.csr.html /usr/share/nginx/html/index.html \
  && chmod -R a+rX /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

RUN chown -R nginx:nginx /usr/share/nginx/html \
  && chown nginx:nginx /etc/nginx/conf.d/default.conf

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
