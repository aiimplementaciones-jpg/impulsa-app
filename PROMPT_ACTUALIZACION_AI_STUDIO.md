# 🛠️ Guía y Prompt para Actualizar la App en Google AI Studio

Usa estas instrucciones y el prompt adjunto para actualizar el generador de dossiers dentro de tu aplicación en **Google AI Studio** (`https://impulsa.ai.studio/#admin`), logrando que:
1. El **Hablador Oficial Personalizado con su QR dinámico** aparezca en la **PÁGINA 1** como el gran protagonista de venta.
2. La **Propuesta de Inversión y Precios** pase ordenadamente a la **PÁGINA 2**.
3. Se conserve el 100% de la funcionalidad, formato A4 imprimible y diseño oficial del hablador.

---

## 📋 PASO A PASO EN GOOGLE AI STUDIO

1. Abre tu proyecto en **Google AI Studio** donde tienes el código fuente de la app.
2. Ve a la sección de **System Instructions / Prompt de la App** o abre el archivo donde se genera el HTML del dossier (generalmente en la función asociada a los botones `Dossier Individual 📄` o `Impresión Masiva Dossiers`).
3. Copia y pega el **PROMPT DE ACTUALIZACIÓN** que encuentras a continuación.

---

## 🤖 PROMPT PARA COPIAR Y PEGAR EN GOOGLE AI STUDIO

```text
Actualiza la función que genera el Dossier Oficial de 2 páginas (para "Dossier Individual" e "Impresión Masiva") con la nueva arquitectura de conversión comercial (V2):

OBJETIVO DEL CAMBIO:
1. PÁGINA 1: Debe contener el encabezado oficial, los datos del comercio, el texto introductorio, y como elemento protagonista CENTRAL el bloque "HABLADOR OFICIAL PERSONALIZADO & PRUEBA EN VIVO" con el arte del hablador acrílico idéntico al físico, el código QR dinámico funcional generado para el comercio, las instrucciones de la Prueba 1 (Filtro 1-4★) y Prueba 2 (Redirección 5★), seguido de la tabla explicativa del Portal de Opinión Inteligente y la barra de confianza.
2. PÁGINA 2: Debe contener la propuesta de inversión completa:
   - Tabla 1: Hardware Físico Tap NFC + QR ($65.000 COP, Pack 2 $115.000 COP, Combo $95.000 COP).
   - Tabla 2: Planes Mensuales (Plan Starter Gratis 30 días, Plan Mensual IMPULSA $95.000 COP/mes).
   - Tabla 3: Servicios Especiales (VIP Google Maps $250.000 COP, Desarrollo Web PWA $750k-$1.3M).
   - Caja de cierre con WhatsApp de Ventas (+57 302 296 6045) y Web (https://impulsa.ai.studio/#home).

REGLAS DE DISEÑO:
- Formato A4 exacto (size: A4 portrait) con page-break-after: always para que al imprimir o guardar en PDF se generen exactamente 2 páginas limpias sin desbordes.
- Tipografía moderna 'Plus Jakarta Sans' o sans-serif de alta legibilidad.
- Inyectar dinámicamente las variables de cada comercio:
  * Nombre del comercio: {{comercio.nombre}}
  * Dirección física: {{comercio.direccion}}
  * Ciudad: {{comercio.ciudad}}
  * URL o datos del QR: https://api.qrserver.com/v1/create-qr-code/?size=150x150&data={{encodeURIComponent(comercio.enlace_maps || comercio.slug_url || 'https://impulsa.ai.studio/#home')}}
  * Fecha de emisión actual.

Asegúrate de que el diseño del arte del hablador mantenga su fondo azul degradé (#1b357d a #0d2864), estrellas doradas, logo IMPULSA, insignia de Google, la franja con la dirección física del comercio y el texto "Tu experiencia nos ayuda a crecer. ¡Toma solo 5 segundos!".
```

---

## 🧩 ESTRUCTURA DE LA PLANTILLA HTML MODULAR

Si tu app en AI Studio inyecta el HTML como una plantilla literal de JavaScript (Template String con `` `...` ``), el bloque de código base corresponde al archivo:
👉 `dossier_oficial_v2.html`

Las variables que debes verificar que se reemplacen son:
- `${comercio.nombre}` ➔ En el título, el párrafo de gancho, la etiqueta del hablador y el pie.
- `${comercio.direccion}` ➔ En la franja azul del hablador y en la cabecera.
- `${encodeURIComponent(qrUrl)}` ➔ En el parámetro `data=` de la imagen del QR.
- `${fechaEmision}` ➔ En el cuadro de personalización.
