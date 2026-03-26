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
# Limpieza profunda
RUN rm -rf /usr/share/nginx/html/*

# Copiamos los archivos
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html

# Ajustamos permisos para que el usuario nginx pueda leer todo
RUN chmod -R 755 /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]