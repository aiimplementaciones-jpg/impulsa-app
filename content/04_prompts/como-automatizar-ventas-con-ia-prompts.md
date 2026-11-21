# Dirección Visual y Prompts Multimedia: Cómo automatizar ventas con IA (Sin perder clientes)

**Fuentes de referencia:**
* Guion de YouTube: `content/02_guiones/como-automatizar-ventas-con-ia-guion.md`
* Adaptación de Instagram: `content/03_redes/como-automatizar-ventas-con-ia-instagram.md`

---

## 1. Miniatura de YouTube (16:9)

**Título de referencia del video:** *Deja de usar Chatbots: Así se automatizan las ventas con IA en 2026 (Sin perder clientes)*

### Concepto Visual
* **Composición y Contraste:** División visual dinámica (60/40) con alto contraste cromático entre **rojo alerta** (el error del chatbot genérico) y **verde neón / esmeralda** (el sistema de agendamiento híbrido que factura).
* **Sujeto Principal:** El creador en primer plano medio-corto (lado derecho o centro-derecha), con expresión de advertencia/revelación (ceja levantada, gesto firme con una mano deteniendo o señalando el teléfono encendido). Iluminación de recorte (*rim light*) en tono verde/cian tecnológico.
* **Fondo y Elementos Secundarios:**
  * **Izquierda (Zona de Dolor / Error):** Interfaz flotante de WhatsApp en modo oscuro con un bloque gigante de texto robótico tachado en rojo, un ícono de robot genérico roto y el doble check azul de *"Visto"*.
  * **Derecha (Zona de Solución / Éxito):** Flujo minimalista de nodos conectados (estilo n8n/Make) que desemboca en una notificación brillante de Google Calendar: *"Nueva llamada agendada ✅"* y el indicador sutil de *"Escribiendo..."*.
* **Emoción:** Urgencia competitiva + curiosidad técnica ("estoy perdiendo dinero con mi bot actual y necesito ver esta arquitectura").

### Texto de Apoyo (En Miniatura)
> **OPCIONES DE TEXTO (Máximo 3-4 palabras, complementarias al título):**
> * **Opción A (Recomendada - Foco en el dolor):** `TE DEJAN EN VISTO`
> * **Opción B (Foco en velocidad/sistema):** `AGENDA EN 8 SEG`
> * **Opción C (Foco en costo/reemplazo):** `SISTEMA DE $80/MES`
>
> *Tipografía sugerida:* Sans-serif pesada y condensada (ej. *Montserrat ExtraBold*, *Impact* o * Druk Wide*), texto blanco puro con trazo/sombra negra profunda y una palabra clave resaltada en bloque rojo o amarillo vibrante.

### Prompt Técnico para Generador de Imágenes (Midjourney v6 / Flux)

**Prompt Principal (Con Sujeto Hiperrealista + Entorno UI):**
```text
Hyper-realistic YouTube thumbnail composition, 16:9 aspect ratio. A confident Hispanic male tech entrepreneur in his early 30s wearing a sleek matte black crewneck sweater, looking directly at the camera with an expressive warning gesture, holding a glowing smartphone. Split background with extreme color contrast: on the left side, warm crimson red lighting illuminating a blurred floating chat bubble filled with a massive wall of robotic text and a glowing red X icon; on the right side, vibrant emerald green and cyan neon rim lighting with sleek dark-mode automation nodes and a glowing calendar checkmark notification icon floating in depth of field. Cinematic studio lighting, high micro-contrast, sharp focus on eyes, 85mm f/1.8 lens, dark studio background with subtle volumetric glow, photorealistic, 8k resolution --ar 16:9 --style raw --v 6.1
```

**Prompt Alternativo (Minimalista / Conceptual de Alto Impacto sin Rostro):**
```text
Minimalist high-contrast 3D conceptual render for a YouTube thumbnail, 16:9 aspect ratio. Split screen dark-mode composition. Left side bathed in subtle red glow: a glossy smartphone screen showing an overwhelming endless paragraph of robotic text coming from a vintage tin robot head icon, with a blue double-check "read" symbol fading away. Right side bathed in vibrant emerald green and electric blue light: a sleek smartphone displaying two short, natural chat bubbles, a glowing "typing..." indicator, connected by luminous fiber-optic automation lines to a 3D calendar icon with a green checkmark. Clean dark matte carbon background, octane render, studio rim lighting, sharp depth of field, ultra-clean UI design aesthetic --ar 16:9 --v 6.1
```

---

## 2. Portada de Instagram (Carrusel 4:5 y Portada de Reel 9:16)

**Texto del Slide 1 de referencia:**
*Deja de conectar ChatGPT a tu WhatsApp para "vender". Estás quemando tus mejores leads (Así se automatiza en 2026) 👉*

### Jerarquía Tipográfica y Composición de Diseño
* **Distribución del Lienzo (4:5 - 1080x1350 px):**
  * **Tercio Superior (Cabecera Tipográfica - 35% del lienzo):** Fondo limpio oscuro (`#0B0F17`) con margen de aire amplio para que el texto sea 100% legible en el feed móvil.
    * **Nivel 1 (Hook Principal):** *"DEJA DE CONECTAR CHATGPT A TU WHATSAPP PARA «VENDER»"* — Tipografía Sans-serif Bold/Black en blanco (`#FFFFFF`), con *"CHATGPT"* y *"«VENDER»"* subrayados o encapsulados en una pastilla rojo coral (`#FF3B30`).
    * **Nivel 2 (Subtítulo / Promesa):** *"Estás quemando tus mejores leads. Así se instala un Sistema Híbrido en 2026 👉"* — Tipografía Medium en gris claro (`#A0AEC0`) con *"Sistema Híbrido"* en verde neón (`#10B981`).
  * **Dos Tercios Inferiores (Elemento Visual Central - 65% del lienzo):** Comparativa visual inmediata ("Antes vs. Después") sobre la imagen de base generada.
    * **Izquierda (Etiqueta roja `❌ Bot Genérico`):** Burbuja de texto interminable con sello de *"VISTO 👀"*.
    * **Derecha (Etiqueta verde `✅ Setter Híbrido IA`):** 2 burbujas cortas + indicador *"Escribiendo..."* conectado a una tarjeta de Google Calendar (*"Reunión confirmada - 4:00 PM"*).
* **Elementos de Fondo:** Textura de cuadrícula de puntos sutil (*dot grid* estilo pizarra de arquitectura de software en Figma/n8n), viñeteado oscuro en los bordes para centrar la atención y resplandor radial suave detrás de los teléfonos.

### Prompts para la Imagen de Base (Fondo y Elementos Visuales)

**Opción 1: Base Fotográfica con Smartphones en Perspectiva (Para superponer UI y Texto en la parte superior)**
```text
Editorial tech photography for Instagram carousel cover, 4:5 vertical aspect ratio, leaving 40% clean dark negative space at the top for typography. In the lower half, two sleek frameless smartphones floating side by side at a slight dynamic angle over a dark matte obsidian surface with a subtle glowing dot-grid pattern. The phone on the left emits a faint red glow with a cluttered chat interface; the phone on the right emits a vibrant emerald green glow connected to floating translucent glassmorphism cards showing a calendar checkmark and connected workflow nodes. Minimalist dark-mode aesthetic, dramatic studio rim lighting, shallow depth of field, shot on Phase One XF IQ4, ultra-clean commercial look --ar 4:5 --style raw --v 6.1
```

**Opción 2: Fondo Abstracto de Arquitectura Híbrida (Para diseñadores que armarán las capturas de WhatsApp en Figma/Canva)**
```text
Minimalist dark-mode tech background for Instagram cover, 4:5 aspect ratio. Deep charcoal and navy blue matte canvas (#0B0F17) with a subtle architectural dot-grid texture. Top half is completely clean and dark for text placement. Bottom half features abstract glowing 3D glassmorphism workflow nodes and delicate luminous connection lines transitioning from a warm crimson red on the bottom-left to a vibrant emerald green (#10B981) on the bottom-right. Soft volumetric lighting, sleek SaaS aesthetic, Apple and Linear design inspiration, high resolution, zero text, clutter-free --ar 4:5 --style raw --v 6.1
```
