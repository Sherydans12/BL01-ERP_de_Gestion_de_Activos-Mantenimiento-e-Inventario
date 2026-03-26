# Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build -- --configuration=production

# Nginx
FROM nginx:stable-alpine
RUN rm -rf /usr/share/nginx/html/*

# Copiamos los archivos generados
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html

# AUTOMATIZACIÓN: Copiar index.csr.html a index.html para Nginx
RUN cp /usr/share/nginx/html/index.csr.html /usr/share/nginx/html/index.html

# Ajustamos permisos
RUN chmod -R 755 /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]