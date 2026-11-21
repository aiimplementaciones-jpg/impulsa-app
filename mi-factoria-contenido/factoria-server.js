const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { URL } = require('url');

const PORT = process.env.PORT || 3456;
const ROOT_DIR = __dirname;
const CONTENT_DIR = path.join(ROOT_DIR, 'content');

const DIRS = {
  idea: path.join(CONTENT_DIR, '01_ideas'),
  guion: path.join(CONTENT_DIR, '02_guiones'),
  instagram: path.join(CONTENT_DIR, '03_redes'),
  prompts: path.join(CONTENT_DIR, '04_prompts'),
  disenos: path.join(CONTENT_DIR, '05_disenos'),
};

Object.values(DIRS).forEach((dir) => {
  fs.mkdirSync(dir, { recursive: true });
});

function slugify(text) {
  const base = text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length <= 50) return base;
  const cut = base.slice(0, 50).replace(/-[^-]*$/, '');
  return (cut || base.slice(0, 50)).replace(/-+$/, '');
}

function getFilePaths(slug) {
  return {
    idea: path.join(DIRS.idea, `${slug}.md`),
    guion: path.join(DIRS.guion, `${slug}-guion.md`),
    instagram: path.join(DIRS.instagram, `${slug}-instagram.md`),
    prompts: path.join(DIRS.prompts, `${slug}-prompts.md`),
  };
}

function getDesignDirs(slug) {
  const base = path.join(DIRS.disenos, slug);
  const refs = path.join(base, 'referencias');
  const gen = path.join(base, 'generadas');
  const logFile = path.join(base, 'bitacora-diseno.md');
  fs.mkdirSync(refs, { recursive: true });
  fs.mkdirSync(gen, { recursive: true });
  return { base, refs, gen, logFile };
}

function readSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (err) {
    // ignore
  }
  return null;
}

function extractTitle(markdown, fallbackSlug) {
  if (markdown) {
    const match = markdown.match(/^#\s+(.+)$/m);
    if (match) {
      return match[1].replace(/\*\*/g, '').trim();
    }
  }
  return fallbackSlug.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

// Extrae automáticamente sugerencias visuales, textos de apoyo y prompts de los archivos de agentes
function extractVisualSuggestions(slug) {
  const paths = getFilePaths(slug);
  const promptsMd = readSafe(paths.prompts) || '';
  const guionMd = readSafe(paths.guion) || '';
  const igMd = readSafe(paths.instagram) || '';
  const ideaMd = readSafe(paths.idea) || '';

  const textOverlays = new Set();
  const codeBlocks = [];
  const conceptNotes = [];

  // 1. Extraer textos cortos en backticks dentro de 04_prompts (ej. `TE DEJAN EN VISTO`, `4.2★ vs 4.9★`)
  const inlineTicks = promptsMd.match(/`([^`\n]{3,38})`/g) || [];
  inlineTicks.forEach((raw) => {
    const clean = raw.replace(/`/g, '').trim();
    if (
      clean &&
      !clean.includes('--ar') &&
      !clean.startsWith('#') &&
      !clean.includes('.md') &&
      !clean.includes('1080x') &&
      !clean.includes('16:9') &&
      !clean.includes('4:5') &&
      !clean.includes('9:16')
    ) {
      textOverlays.add(clean);
    }
  });

  // 2. Extraer [TEXTO EN PANTALLA] del guion de YouTube
  const screenTexts = guionMd.match(/\[TEXTO EN PANTALLA\]:?\s*([^\n]+)/gi) || [];
  screenTexts.forEach((line) => {
    const val = line
      .replace(/\[TEXTO EN PANTALLA\]:?/i, '')
      .replace(/[*`"]/g, '')
      .trim();
    if (val && val.length <= 45) {
      textOverlays.add(val);
    }
  });

  // 3. Extraer bloques de código (prompts técnicos de imagen) de 04_prompts
  const blockRegex = /```(?:text|prompt|markdown)?\s*([\s\S]*?)```/g;
  let match;
  let idx = 1;
  while ((match = blockRegex.exec(promptsMd)) !== null) {
    const content = match[1].trim();
    if (content.length > 30) {
      const isVertical = content.includes('4:5') || content.includes('9:16') || content.toLowerCase().includes('vertical');
      codeBlocks.push({
        id: `prompt-${idx++}`,
        format: isVertical ? '4:5' : '16:9',
        label: isVertical ? `Portada Instagram / Reel (#${idx - 1})` : `Miniatura YouTube 16:9 (#${idx - 1})`,
        prompt: content,
      });
    }
  }

  // 4. Extraer notas de Concepto Visual y Composición
  const lines = promptsMd.split('\n');
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (
      trimmed.startsWith('* **Composición') ||
      trimmed.startsWith('* **Sujeto') ||
      trimmed.startsWith('* **Emoción') ||
      trimmed.startsWith('* **Fondo') ||
      trimmed.startsWith('* **Zona') ||
      trimmed.startsWith('* **Concepto')
    ) {
      conceptNotes.push(trimmed.replace(/^\*\s*/, '').replace(/\*\*/g, ''));
    }
  });

  // Si aún hay pocos textos, extraer títulos de idea
  if (textOverlays.size === 0 && ideaMd) {
    textOverlays.add('SISTEMA IA 24/7');
    textOverlays.add('PASO A PASO');
  }

  return {
    textOverlays: Array.from(textOverlays).slice(0, 12),
    prompts: codeBlocks,
    conceptNotes: conceptNotes.slice(0, 8),
    hasPromptsFile: Boolean(promptsMd),
    hasGuionFile: Boolean(guionMd),
    hasIgFile: Boolean(igMd),
  };
}

function listImagesInDir(dirPath, relPrefix) {
  if (!fs.existsSync(dirPath)) return [];
  const exts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);
  return fs
    .readdirSync(dirPath)
    .filter((f) => exts.has(path.extname(f).toLowerCase()))
    .map((f) => {
      const full = path.join(dirPath, f);
      const stat = fs.statSync(full);
      return {
        name: f,
        relPath: `${relPrefix}/${f}`.replace(/\\/g, '/'),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function listWorkspaceSampleImages() {
  const exts = new Set(['.png', '.jpg', '.jpeg', '.webp']);
  const results = [];
  try {
    fs.readdirSync(ROOT_DIR).forEach((f) => {
      const ext = path.extname(f).toLowerCase();
      if (exts.has(ext)) {
        const full = path.join(ROOT_DIR, f);
        const stat = fs.statSync(full);
        if (stat.isFile()) {
          results.push({
            name: f,
            relPath: f,
            size: stat.size,
          });
        }
      }
    });
  } catch (_) {}
  return results;
}

function listProjects() {
  const slugs = new Set();

  if (fs.existsSync(DIRS.idea)) {
    fs.readdirSync(DIRS.idea).forEach((file) => {
      if (file.endsWith('.md')) slugs.add(file.replace(/\.md$/, ''));
    });
  }
  if (fs.existsSync(DIRS.guion)) {
    fs.readdirSync(DIRS.guion).forEach((file) => {
      if (file.endsWith('-guion.md')) slugs.add(file.replace(/-guion\.md$/, ''));
    });
  }

  const projects = [];
  for (const slug of slugs) {
    const paths = getFilePaths(slug);
    const designDirs = getDesignDirs(slug);
    const ideaContent = readSafe(paths.idea);
    let updatedAt = 0;

    const stages = {};
    for (const [key, filePath] of Object.entries(paths)) {
      if (fs.existsSync(filePath)) {
        stages[key] = true;
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs > updatedAt) updatedAt = stat.mtimeMs;
      } else {
        stages[key] = false;
      }
    }

    const genImages = listImagesInDir(designDirs.gen, `content/05_disenos/${slug}/generadas`);
    stages.disenos = genImages.length > 0;

    projects.push({
      slug,
      title: extractTitle(ideaContent, slug),
      updatedAt,
      stages,
      designCount: genImages.length,
    });
  }

  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

function hasAgyCli() {
  if (process.env.USE_GEMINI_DIRECT === 'true') return false;
  try {
    const { execSync } = require('child_process');
    execSync(process.platform === 'win32' ? 'where agy' : 'which agy', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

async function callGeminiApi({ systemInstruction, prompt }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Ni el comando "agy" ni la variable "GEMINI_API_KEY" están disponibles. Configura GEMINI_API_KEY en tu archivo .env o en Easypanel.');
  }
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  };

  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error en API de Gemini (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map(p => p.text).join('') || '';
  return text;
}

function runAgyStep({ agent, prompt, onData }) {
  return new Promise((resolve, reject) => {
    const args = ['--agent', agent, '--mode', 'accept-edits', '-p', prompt];
    const child = spawn('agy', args, {
      cwd: ROOT_DIR,
      shell: false,
      env: { ...process.env },
    });

    child.stdout.on('data', (chunk) => onData(chunk.toString()));
    child.stderr.on('data', (chunk) => onData(chunk.toString()));
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`El agente ${agent} finalizó con código ${code}`));
    });
  });
}

async function runAgentStep({ agent, prompt, expectedFile, onData }) {
  if (hasAgyCli()) {
    return runAgyStep({ agent, prompt, onData });
  }

  // Modo Nube / VPS autónomo: Ejecuta directamente con Gemini API
  onData(`[CLOUD VPS] Ejecutando agente "${agent}" en la nube...\n`);

  const agentMdPath = path.join(ROOT_DIR, '.agents', 'agents', agent, 'agent.md');
  const agentMd = readSafe(agentMdPath) || '';

  const brandDnaPath = path.join(ROOT_DIR, 'BRAND_DNA_AI_IMPLEMENTACIONES.md');
  const brandDna = readSafe(brandDnaPath) || '';

  const systemInstruction = [
    `Eres el agente "${agent}" del ecosistema de contenido de Aiimplementaciones.`,
    brandDna ? `REGLAS MAESTRAS DE MARCA Y CONTENIDO:\n${brandDna}` : '',
    agentMd ? `INSTRUCCIONES ESPECÍFICAS DEL AGENTE:\n${agentMd}` : '',
    'IMPORTANTE: Devuelve directamente el documento en formato Markdown limpio listo para guardar en el archivo, sin introducciones ni saludos.'
  ].filter(Boolean).join('\n\n');

  let enrichedPrompt = prompt;
  const fileRefs = prompt.match(/content\/(?:01_ideas|02_guiones|03_redes|04_prompts)\/[^\s"',`)]+/g) || [];
  for (const ref of fileRefs) {
    const absRef = path.join(ROOT_DIR, ref);
    const refContent = readSafe(absRef);
    if (refContent) {
      enrichedPrompt += `\n\n--- ARCHIVO DE ENTRADA (${ref}) ---\n${refContent}\n--- FIN DE ARCHIVO ---`;
    }
  }

  onData(`[CLOUD VPS] Generando contenido con IA...\n`);
  const result = await callGeminiApi({ systemInstruction, prompt: enrichedPrompt });

  let cleanMarkdown = result.trim();
  if (cleanMarkdown.startsWith('```markdown') && cleanMarkdown.endsWith('```')) {
    cleanMarkdown = cleanMarkdown.slice(11, -3).trim();
  } else if (cleanMarkdown.startsWith('```') && cleanMarkdown.endsWith('```')) {
    cleanMarkdown = cleanMarkdown.slice(3, -3).trim();
  }

  if (expectedFile) {
    fs.mkdirSync(path.dirname(expectedFile), { recursive: true });
    fs.writeFileSync(expectedFile, cleanMarkdown, 'utf8');
    onData(`[CLOUD VPS] Archivo guardado exitosamente: ${path.basename(expectedFile)}\n`);
  }

  return cleanMarkdown;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error('Archivo demasiado grande'));
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // 1. Servir interfaz principal
  if (req.method === 'GET' && (pathname === '/' || pathname === '/factoria.html')) {
    const htmlPath = path.join(ROOT_DIR, 'factoria.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(htmlPath, 'utf8'));
    } else {
      res.writeHead(404);
      res.end('No se encontró factoria.html');
    }
    return;
  }

  // 2. Servir imágenes locales de forma segura (/api/image?path=...)
  if (req.method === 'GET' && pathname === '/api/image') {
    const rel = parsedUrl.searchParams.get('path') || '';
    const resolved = path.resolve(ROOT_DIR, rel);
    if (!resolved.startsWith(ROOT_DIR) || !fs.existsSync(resolved)) {
      res.writeHead(404);
      res.end('Imagen no encontrada');
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_MAP[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(resolved).pipe(res);
    return;
  }

  // 3. Listar todos los proyectos generados
  if (req.method === 'GET' && pathname === '/api/projects') {
    const projects = listProjects();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ projects }));
    return;
  }

  // 4. Obtener datos del Estudio de Diseño para un proyecto
  if (req.method === 'GET' && pathname.match(/^\/api\/projects\/[^/]+\/designs$/)) {
    const slug = decodeURIComponent(pathname.split('/')[3]);
    const designDirs = getDesignDirs(slug);
    const references = listImagesInDir(
      designDirs.refs,
      `content/05_disenos/${slug}/referencias`
    );
    const generated = listImagesInDir(
      designDirs.gen,
      `content/05_disenos/${slug}/generadas`
    );
    const workspaceImages = listWorkspaceSampleImages();
    const suggestions = extractVisualSuggestions(slug);
    const designLog = readSafe(designDirs.logFile) || '';

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        slug,
        references,
        generated,
        workspaceImages,
        suggestions,
        designLog,
      })
    );
    return;
  }

  // 5. Subir imagen de referencia o importar una del workspace
  if (req.method === 'POST' && pathname.match(/^\/api\/projects\/[^/]+\/upload-reference$/)) {
    const slug = decodeURIComponent(pathname.split('/')[3]);
    const designDirs = getDesignDirs(slug);
    try {
      const body = await readJsonBody(req);
      if (body.workspaceFile) {
        const src = path.resolve(ROOT_DIR, body.workspaceFile);
        if (!src.startsWith(ROOT_DIR) || !fs.existsSync(src)) {
          throw new Error('Archivo de origen no encontrado');
        }
        const safeName = path.basename(src).replace(/[^a-zA-Z0-9._-]/g, '_');
        const dest = path.join(designDirs.refs, safeName);
        fs.copyFileSync(src, dest);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            relPath: `content/05_disenos/${slug}/referencias/${safeName}`,
          })
        );
        return;
      }

      const { fileName, dataUrl } = body;
      const matches = (dataUrl || '').match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (!matches) throw new Error('Formato de imagen inválido');

      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const baseName = path
        .basename(fileName || `referencia-${Date.now()}`, path.extname(fileName || ''))
        .replace(/[^a-zA-Z0-9_-]/g, '_');
      const finalName = `${baseName}-${Date.now().toString().slice(-4)}.${ext}`;
      const destPath = path.join(designDirs.refs, finalName);

      fs.writeFileSync(destPath, Buffer.from(matches[2], 'base64'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          name: finalName,
          relPath: `content/05_disenos/${slug}/referencias/${finalName}`,
        })
      );
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 6. Guardar diseño compuesto en el Canvas hacia la galería de generadas
  if (req.method === 'POST' && pathname.match(/^\/api\/projects\/[^/]+\/save-design$/)) {
    const slug = decodeURIComponent(pathname.split('/')[3]);
    const designDirs = getDesignDirs(slug);
    try {
      const { label, dataUrl } = await readJsonBody(req);
      const matches = (dataUrl || '').match(/^data:image\/png;base64,(.+)$/);
      if (!matches) throw new Error('Datos PNG inválidos');

      const cleanLabel = slugify(label || 'diseno') || 'pieza';
      const finalName = `${cleanLabel}-${Date.now().toString().slice(-5)}.png`;
      const destPath = path.join(designDirs.gen, finalName);
      fs.writeFileSync(destPath, Buffer.from(matches[1], 'base64'));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          name: finalName,
          relPath: `content/05_disenos/${slug}/generadas/${finalName}`,
        })
      );
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 7. Ejecutar Agente Diseñador IA (05-disenador) sobre imagen de referencia + guiones/prompts
  if (req.method === 'GET' && pathname === '/api/design-stream') {
    const slug = (parsedUrl.searchParams.get('slug') || '').trim();
    const refPath = (parsedUrl.searchParams.get('refPath') || '').trim();
    const format = (parsedUrl.searchParams.get('format') || '16:9').trim();
    const instructions = (parsedUrl.searchParams.get('instructions') || '').trim();
    const basePrompt = (parsedUrl.searchParams.get('basePrompt') || '').trim();

    if (!slug) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Falta indicar el proyecto (slug).' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const sendEvent = (type, payload) => {
      res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    const designDirs = getDesignDirs(slug);
    const outFileName = `ia-${format.replace(':', 'x')}-${Date.now().toString().slice(-5)}.png`;
    const outRelPath = `content/05_disenos/${slug}/generadas/${outFileName}`;

    const refInstruction = refPath
      ? `IMAGEN DE REFERENCIA SUBIDA POR EL USUARIO: "${refPath}". Primero inspecciónala con read_file y úsala como referencia visual (manteniendo la esencia/producto/sujeto según corresponda y aplicando las mejoras solicitadas).`
      : `No se especificó imagen de referencia previa; genera la pieza visual desde cero siguiendo las especificaciones.`;

    const agentPrompt = [
      `Actúa como el Agente Diseñador Visual para el proyecto "${slug}".`,
      `1. Lee las especificaciones visuales en "content/04_prompts/${slug}-prompts.md" (y revisa "content/02_guiones/${slug}-guion.md" si necesitas contexto adicional).`,
      `2. ${refInstruction}`,
      `3. Formato objetivo: ${format}.`,
      basePrompt ? `4. Prompt / Concepto base seleccionado de los agentes:\n${basePrompt}` : '',
      instructions ? `5. Cambios e instrucciones específicas solicitadas por el usuario:\n"${instructions}"` : '',
      `6. Usa tu herramienta generate_image (o invoke_subagent con image-generator) pasando la imagen de referencia (si existe) y un prompt detallado para producir la nueva imagen con los cambios aplicados. Copia o guarda la imagen generada en "${outRelPath}".`,
      `7. Además, actualiza o escribe en "content/05_disenos/${slug}/bitacora-diseno.md" un resumen de dirección de arte explicando los cambios aplicados sobre la referencia, la paleta de color exacta (códigos HEX), sugerencia de texto de apoyo en pantalla y por qué este cambio maximiza el CTR según el guion.`,
    ]
      .filter(Boolean)
      .join('\n\n');

    sendEvent('start', { slug, outRelPath });

    let fullLog = '';
    try {
      await runAgentStep({
        agent: '05-disenador',
        prompt: agentPrompt,
        onData: (text) => {
          fullLog += text;
          sendEvent('log', { text });
        },
      });

      // Si el agente o subagente guardó una ruta de imagen en el log pero no la copió a outRelPath, la detectamos y copiamos
      const destAbs = path.join(ROOT_DIR, outRelPath);
      if (!fs.existsSync(destAbs)) {
        const pathMatches =
          fullLog.match(/[A-Za-z]:[\\/][^\s"'`<>|]+\.(?:png|jpg|jpeg|webp)/gi) || [];
        for (const candidate of pathMatches) {
          if (fs.existsSync(candidate)) {
            fs.copyFileSync(candidate, destAbs);
            break;
          }
        }
      }

      sendEvent('done', {
        slug,
        imageCreated: fs.existsSync(destAbs),
        outRelPath: fs.existsSync(destAbs) ? outRelPath : null,
      });
    } catch (err) {
      sendEvent('error', { message: err.message });
    } finally {
      res.end();
    }
    return;
  }

  // 8. Obtener detalle de un proyecto por slug
  if (req.method === 'GET' && pathname.startsWith('/api/projects/')) {
    const slug = decodeURIComponent(pathname.replace('/api/projects/', ''));
    const paths = getFilePaths(slug);
    const data = {
      slug,
      files: {
        idea: readSafe(paths.idea),
        guion: readSafe(paths.guion),
        instagram: readSafe(paths.instagram),
        prompts: readSafe(paths.prompts),
      },
      paths: {
        idea: `content/01_ideas/${slug}.md`,
        guion: `content/02_guiones/${slug}-guion.md`,
        instagram: `content/03_redes/${slug}-instagram.md`,
        prompts: `content/04_prompts/${slug}-prompts.md`,
        disenos: `content/05_disenos/${slug}/`,
      },
    };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
    return;
  }

  // 9. Guardar edición manual de un archivo
  if (req.method === 'PUT' && pathname.startsWith('/api/projects/')) {
    const parts = pathname.replace('/api/projects/', '').split('/');
    const slug = decodeURIComponent(parts[0] || '');
    const stage = parts[1];
    const paths = getFilePaths(slug);

    if (!paths[stage]) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Etapa inválida' }));
      return;
    }

    try {
      const { content } = await readJsonBody(req);
      fs.writeFileSync(paths[stage], content, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // 10. Ejecutar pipeline principal con streaming en tiempo real
  if (req.method === 'GET' && pathname === '/api/run-stream') {
    const tema = (parsedUrl.searchParams.get('tema') || '').trim();
    const customSlug = (parsedUrl.searchParams.get('slug') || '').trim();
    const onlyStage = (parsedUrl.searchParams.get('stage') || 'all').trim();

    const slug = customSlug || slugify(tema);
    if (!slug) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Debes indicar un tema válido.' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const sendEvent = (type, payload) => {
      res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    const paths = getFilePaths(slug);
    const allSteps = [
      {
        key: 'idea',
        stepNum: 1,
        name: 'Agente Investigador',
        agent: '01-investigador',
        prompt: `Investiga el tema: '${tema || slug}'. Guarda el resultado exactamente en content/01_ideas/${slug}.md`,
        expectedFile: paths.idea,
      },
      {
        key: 'guion',
        stepNum: 2,
        name: 'Agente Guionista (YouTube)',
        agent: '02-guionista',
        prompt: `Lee content/01_ideas/${slug}.md y redacta el guion completo. Guárdalo en content/02_guiones/${slug}-guion.md`,
        expectedFile: paths.guion,
      },
      {
        key: 'instagram',
        stepNum: 3,
        name: 'Agente Adaptador (Instagram)',
        agent: '03-redes',
        prompt: `Lee content/02_guiones/${slug}-guion.md y genera el carrusel, reel y copy. Guárdalo en content/03_redes/${slug}-instagram.md`,
        expectedFile: paths.instagram,
      },
      {
        key: 'prompts',
        stepNum: 4,
        name: 'Agente de Dirección Visual',
        agent: '04-multimedia',
        prompt: `Lee content/02_guiones/${slug}-guion.md y content/03_redes/${slug}-instagram.md, y crea los prompts visuales en content/04_prompts/${slug}-prompts.md`,
        expectedFile: paths.prompts,
      },
    ];

    const stepsToRun =
      onlyStage === 'all' ? allSteps : allSteps.filter((s) => s.key === onlyStage);

    sendEvent('init', { tema: tema || slug, slug, totalSteps: stepsToRun.length });

    try {
      for (const step of stepsToRun) {
        sendEvent('step-start', {
          key: step.key,
          stepNum: step.stepNum,
          name: step.name,
          agent: step.agent,
        });

        await runAgentStep({
          agent: step.agent,
          prompt: step.prompt,
          expectedFile: step.expectedFile,
          onData: (text) => {
            sendEvent('log', { key: step.key, text });
          },
        });

        if (!fs.existsSync(step.expectedFile)) {
          throw new Error(
            `No se encontró el archivo esperado tras ejecutar ${step.name}: ${path.basename(step.expectedFile)}`
          );
        }

        const content = readSafe(step.expectedFile);
        sendEvent('step-complete', {
          key: step.key,
          stepNum: step.stepNum,
          content,
        });
      }

      sendEvent('done', { slug });
    } catch (err) {
      sendEvent('error', { message: err.message });
    } finally {
      res.end();
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
});

server.listen(PORT, () => {
  console.log('====================================================');
  console.log('🚀 Factoría de Contenido IA + Estudio de Diseño Activo');
  console.log(`🌐 Abre en tu navegador: http://localhost:${PORT}`);
  console.log('====================================================');
});
