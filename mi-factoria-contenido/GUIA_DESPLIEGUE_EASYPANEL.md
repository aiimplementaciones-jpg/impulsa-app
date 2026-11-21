# 🚀 Guía de Despliegue 24/7 en Easypanel (Hostinger VPS)
## Factoría de Agentes de Contenido • Aiimplementaciones

Esta guía detalla cómo desplegar tu servidor de agentes en tu VPS de Hostinger gestionado con **Easypanel** para tener tu panel web de generación de contenido disponible las 24 horas del día.

---

## 📦 1. Archivos Listos para Producción

Ya se han preparado los siguientes archivos en este proyecto:

* **[package.json](file:///c:/Users/USUARIO/.gemini/antigravity/scratch/impulsa/package.json):** Manifiesto de Node.js configurado para arranque automático.
* **[Dockerfile](file:///c:/Users/USUARIO/.gemini/antigravity/scratch/impulsa/Dockerfile):** Imagen ligera y segura basada en `node:20-alpine` que expone el puerto `3456`.
* **[.dockerignore](file:///c:/Users/USUARIO/.gemini/antigravity/scratch/impulsa/.dockerignore):** Excluye archivos pesados temporales o PDFs para un build veloz.
* **[.env.example](file:///c:/Users/USUARIO/.gemini/antigravity/scratch/impulsa/.env.example):** Plantilla de variables de entorno requeridas.
* **[factoria-server.js](file:///c:/Users/USUARIO/.gemini/antigravity/scratch/impulsa/factoria-server.js):** Servidor mejorado con **doble motor**:
  * Si se ejecuta localmente, usa el CLI `agy`.
  * Si se ejecuta en tu VPS (Docker), se conecta directamente a la API de **Google Gemini** con tu `GEMINI_API_KEY`, procesando el ADN de marca y las instrucciones de los 5 agentes de forma 100% autónoma.
* **[BRAND_DNA_AI_IMPLEMENTACIONES.md](file:///c:/Users/USUARIO/.gemini/antigravity/scratch/impulsa/BRAND_DNA_AI_IMPLEMENTACIONES.md):** Manual rector que guía a la IA en cada generación.

---

## 🐙 2. Paso Previo: Subir a GitHub

### Opción A: Crear un Nuevo Repositorio en GitHub (Recomendado)
1. Ve a [GitHub](https://github.com/new) y crea un nuevo repositorio llamado:  
   `factoria-agentes-aiimplementaciones` (puedes marcarlo como **Private** o **Public**).
2. Si prefieres aislar solo la factoría o subir la carpeta completa, solo agregas el remoto y haces push:
   ```bash
   git add .
   git commit -m "feat: preparar factoria de contenido para despliegue en Easypanel"
   git push origin main
   ```

---

## 🖥️ 3. Configuración en Easypanel (Hostinger VPS)

Entra a tu panel de Easypanel (`https://tu-ip-o-dominio:3000`):

### Paso 1: Crear el Servicio
1. Selecciona tu **Project** (o crea uno nuevo llamado `Aiimplementaciones`).
2. Haz clic en el botón **+ Service** y elige **App**.
3. Ponle un nombre al servicio, por ejemplo: `factoria-contenido`.

### Paso 2: Conectar con GitHub (Source)
1. En la pestaña **Source**, selecciona **GitHub**.
2. Conecta tu cuenta de GitHub y elige tu repositorio:  
   `aiimplementaciones-jpg/impulsa-app` (o el repositorio dedicado que crees).
3. Rama (**Branch**): `main`.
4. Método de construcción (**Build Type**): Selecciona **Dockerfile** (Easypanel detectará automáticamente el archivo `Dockerfile` del proyecto).

### Paso 3: Variables de Entorno (Environment)
Ve a la pestaña **Environment** y añade las siguientes variables:
```env
PORT=3456
NODE_ENV=production
GEMINI_API_KEY=AIzaSy... (Tu clave de Google AI Studio)
GEMINI_MODEL=gemini-2.5-flash
```
> 💡 *Nota:* Puedes obtener una API Key gratuita o de pago por uso en [Google AI Studio](https://aistudio.google.com/app/apikey).

### Paso 4: Configurar Dominio y Certificado SSL (HTTPS)
1. Ve a la pestaña **Domains** en Easypanel.
2. Agrega el subdominio que prefieras (por ejemplo: `agentes.aiimplementaciones.com` o `factoria.tudominio.com`).
3. En tu proveedor DNS (Hostinger o Cloudflare), asegúrate de que ese subdominio apunte con un registro `A` a la IP de tu VPS.
4. Easypanel activará automáticamente el candado verde SSL gratuito con Let's Encrypt.
5. Define el **Container Port** en: `3456`.

### Paso 5: Desplegar (Deploy)
1. Haz clic en el botón verde **Deploy**.
2. Easypanel compilará el contenedor en aproximadamente 60 segundos.
3. Cuando el estado cambie a **Running** (Verde), ¡tu panel web estará en línea 24/7!

---

## 📱 4. ¿Cómo lo Usarás en tu Día a Día?

1. Desde tu celular o cualquier computador, abres tu enlace: `https://agentes.tudominio.com`.
2. Escribes la idea del video o caso de negocio (ej: *"Cómo las clínicas dentales evitan reseñas negativas con tecnología NFC"*).
3. Presionas **"Ejecutar Pipeline Completo"**.
4. En cuestión de 30-45 segundos, verás en vivo:
   - El análisis del **Agente Investigador**.
   - El guion de video vertical del **Agente Guionista**.
   - La adaptación a TikTok, Reels y Carrusel de Instagram del **Agente Redes**.
   - Los conceptos y prompts visuales del **Agente Multimedia**.
