# 🚀 Agente de Onboarding y Prospección • IMPULSA

Este documento contiene la especificación, estructura de datos para **Firebase Firestore** y guía de uso del subagente especializado **`impulsa-onboarding`**.

---

## 📌 1. Misión del Agente
Automatizar la captación y bienvenida de comercios prospectos a partir de su perfil en redes sociales (Instagram o Facebook):
1. **Analizar y clasificar** el negocio en una de las 14 categorías oficiales del Super Admin de IMPULSA.
2. **Generar el registro JSON** compatible con la colección `marketing_prospects` o `profiles` de Firebase Firestore.
3. **Redactar el Dossier Ejecutivo Personalizado** con precios en COP ($65.000 COP Hablador Acrílico, $95.000 COP/mes Plan Mensual, etc.).
4. **Diseñar el concepto de Hablador Demo** para que el prospecto pruebe la tecnología con su celular.
5. **Generar el mensaje de contacto directo** para WhatsApp o Instagram DM.
6. **Copiloto para responder comentarios y DMs** en la cuenta de Instagram de IMPULSA.

---

## 🗄️ 2. Estructura de Datos para Firebase (`marketing_prospects`)

El agente genera registros con el siguiente esquema para Firestore:

```json
{
  "nombre_comercio": "Nombre Comercial del Negocio",
  "categoria": "Gastronomía / Restaurante",
  "titular": "Nombre del Contacto o Propietario",
  "whatsapp": "+57 300 000 0000",
  "ciudad": "Cali",
  "direccion": "Calle / Carrera / Barrio",
  "enlace_maps": "https://maps.app.goo.gl/...",
  "etapa_crm": "Demo Enviado",
  "plan_sugerido": "Hablador Acrílico L-Stand ($65.000 COP)",
  "origen_contacto": "Instagram DM",
  "notas_diagnostico": "Local de alto tráfico presencial con potencial de captar +40 reseñas/mes.",
  "fecha_creacion": "ISO-8601"
}
```

### 🏷️ 14 Categorías Oficiales Reconocidas:
1. `Gastronomía / Restaurante`
2. `Cafetería / Panadería`
3. `Belleza, Barbería & Spa`
4. `Salud, Odontología & Medicina`
5. `Comercio / Tienda / Retail`
6. `Servicios Profesionales & Consultoría`
7. `Fitness, Gimnasio & Deporte`
8. `Automotriz & Talleres`
9. `Hotelería & Hospedaje`
10. `Educación & Cursos`
11. `Mascotas & Veterinaria`
12. `Tecnología & Reparación`
13. `Entretenimiento & Eventos`
14. `Otro / General`

---

## 💰 3. Oferta Comercial y Precios Oficiales (COP)

- **Hardware Físico (Pago único, sin mensualidades obligatorias, despacho 3 días hábiles):**
  - **1 Hablador Acrílico L-Stand (NFC + QR dinámico):** $65.000 COP
  - **Pack 2 Habladores Acrílicos:** $115.000 COP
  - **Combo Hablador + Placa Adhesiva 3M:** $95.000 COP
- **Planes de Gestión y SEO:**
  - **Plan Mensual IMPULSA:** $95.000 COP/mes (hasta 3 sucursales, respuesta a comentarios < 4h con IA + humano, reportes de gestión).
  - **Servicio VIP Optimización Google Maps:** $250.000 COP pago único (incluye hablador acrílico, verificación NAP y redacción SEO).

---

## 🛠️ 4. Cómo Usar el Subagente

Puedes invocar al subagente en cualquier momento diciendo:
> *"Quiero procesar este nuevo prospecto: [Enlace de Instagram / Facebook o Nombre del local]"*

El agente ejecutará las 5 fases en segundos y te entregará el material listo para copiar, guardar en Firebase y enviar al cliente.
