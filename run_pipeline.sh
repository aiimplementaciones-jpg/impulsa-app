#!/bin/bash

# Detener el script si ocurre algún error
set -e

# Validar que se haya pasado un tema como argumento
if [ -z "$1" ]; then
    echo "❌ Error: Debes indicar el tema o idea principal."
    echo "Uso: ./run_pipeline.sh \"Cómo automatizar ventas con IA\""
    exit 1
fi

TEMA="$1"

# Opciones comunes del CLI de Antigravity (modo no interactivo, auto-aprobar ediciones y permisos)
AGY_FLAGS=(--mode accept-edits --dangerously-skip-permissions)

# Generar un slug limpio (ej. "Cómo automatizar..." -> "como-automatizar...")
SLUG=$(echo "$TEMA" | iconv -t ascii//TRANSLIT | tr -d "'\"\`^~" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g' | sed -E 's/^-+|-+$//g')

echo "🚀 Iniciando Factoría de Contenido"
echo "📌 Tema: $TEMA"
echo "🔖 Slug: $SLUG"
echo "---------------------------------------------------"

# Asegurar que existan las carpetas de salida
mkdir -p content/01_ideas content/02_guiones content/03_redes content/04_prompts

# 1. AGENTE INVESTIGADOR
echo "🔍 [1/4] Ejecutando Agente Investigador..."
agy --agent 01-investigador "${AGY_FLAGS[@]}" \
  -p "Investiga el tema: '$TEMA'. Guarda el resultado exactamente en content/01_ideas/${SLUG}.md"

if [ ! -f "content/01_ideas/${SLUG}.md" ]; then
    echo "⚠️ Error: No se generó content/01_ideas/${SLUG}.md. Abortando."
    exit 1
fi

# 2. AGENTE GUIONISTA
echo "✍️  [2/4] Ejecutando Agente Guionista (YouTube)..."
agy --agent 02-guionista "${AGY_FLAGS[@]}" \
  -p "Lee content/01_ideas/${SLUG}.md y redacta el guion completo. Guárdalo en content/02_guiones/${SLUG}-guion.md"

if [ ! -f "content/02_guiones/${SLUG}-guion.md" ]; then
    echo "⚠️ Error: No se generó el guion. Abortando."
    exit 1
fi

# 3. AGENTE REDES SOCIALES (INSTAGRAM)
echo "📱 [3/4] Ejecutando Agente Adaptador para Instagram..."
agy --agent 03-redes "${AGY_FLAGS[@]}" \
  -p "Lee content/02_guiones/${SLUG}-guion.md y genera el carrusel, reel y copy. Guárdalo en content/03_redes/${SLUG}-instagram.md"

if [ ! -f "content/03_redes/${SLUG}-instagram.md" ]; then
    echo "⚠️ Error: No se generó el contenido de Instagram. Abortando."
    exit 1
fi

# 4. AGENTE MULTIMEDIA / PROMPTS
echo "🎨 [4/4] Ejecutando Agente de Dirección Visual..."
agy --agent 04-multimedia "${AGY_FLAGS[@]}" \
  -p "Lee content/02_guiones/${SLUG}-guion.md y content/03_redes/${SLUG}-instagram.md, y crea los prompts visuales en content/04_prompts/${SLUG}-prompts.md"

if [ ! -f "content/04_prompts/${SLUG}-prompts.md" ]; then
    echo "⚠️ Error: No se generaron los prompts visuales. Abortando."
    exit 1
fi

echo "---------------------------------------------------"
echo "✅ ¡Pipeline completado con éxito!"
echo "📂 Archivos generados:"
echo "   - Idea:      content/01_ideas/${SLUG}.md"
echo "   - Guion YT:  content/02_guiones/${SLUG}-guion.md"
echo "   - Instagram: content/03_redes/${SLUG}-instagram.md"
echo "   - Prompts:   content/04_prompts/${SLUG}-prompts.md"
