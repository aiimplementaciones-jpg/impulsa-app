FROM node:20-alpine

# Directorio de trabajo
WORKDIR /app

# Copiar manifiestos
COPY package*.json ./

# Instalar dependencias si las hubiera
RUN npm install --omit=dev 2>/dev/null || true

# Copiar todo el código fuente
COPY . .

# Exponer el puerto de la Factoría
EXPOSE 3456

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3456

# Comando de arranque
CMD ["node", "factoria-server.js"]
