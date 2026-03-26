# Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build -- --configuration=production

# Nginx
FROM nginx:stable-alpine
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html
# Copiamos la configuración de Nginx para manejar Single Page App y Proxy
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
