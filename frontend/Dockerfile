# Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Instalación limpia
RUN npm ci
COPY . .
# Ejecutamos el build de producción
RUN npm run build -- --configuration=production

# Nginx
FROM nginx:stable-alpine
# Eliminamos el contenido por defecto de nginx para evitar el "Welcome to nginx"
RUN rm -rf /usr/share/nginx/html/*

# Copiamos desde la ruta exacta que define angular.json + /browser
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html

# Copiamos tu configuración de Nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]