const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT_DIR = 'C:\\Users\\USUARIO\\.gemini\\antigravity\\scratch\\impulsa\\Redes\\salida\\overlays';
const HTML_DIR = 'C:\\Users\\USUARIO\\.gemini\\antigravity\\scratch\\impulsa\\Redes\\piezas\\overlays_html';

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(HTML_DIR, { recursive: true });

const hooks = [
  {
    num: '02',
    text: '¿Si buscas dónde cenar hoy en Google Maps, eliges el que tiene 4 reseñas o el que tiene más de 500 de 5 estrellas?'
  },
  {
    num: '03',
    text: 'El 90% de clientes felices se van en silencio... pero al que se le enfrió la sopa te clava 1 estrella pública.'
  },
  {
    num: '04',
    text: '¿Sabías que hay clientes que amenazan con 1 estrella en Google Maps si no les regalas la cuenta?'
  },
  {
    num: '05',
    text: '¿Cómo pasó esta clínica de 15 reseñas a más de 400 opiniones de 5 estrellas en solo 30 días?'
  },
  {
    num: '06',
    text: 'El 80% de tus empleados atiende mejor cuando su esfuerzo se premia con reseñas en tiempo real.'
  },
  {
    num: '07',
    text: '¿Crees que las 5 estrellas en Google solo sirven para restaurantes? Estás perdiendo la mitad de tus clientes.'
  },
  {
    num: '08',
    text: 'Por esta razón los códigos QR tradicionales están muriendo y los mejores locales usan Tap NFC.'
  },
  {
    num: '09',
    text: 'Este restaurante estuvo a punto de recibir 1 estrella por una sopa fría... pero el sistema lo salvó en 3 minutos.'
  },
  {
    num: '10',
    text: '¿Sabías que 10 años de carrera médica pueden arruinarse si un paciente te clava 1 estrella por la sala de espera?'
  }
];

for (const h of hooks) {
  const htmlFile = path.join(HTML_DIR, `overlay_${h.num}.html`);
  const pngFile = path.join(OUT_DIR, `overlay_gancho_${h.num}.png`);

  const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'Outfit';
    src: url('../../assets/Outfit.ttf') format('truetype');
    font-weight: 700;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 1080px;
    height: 1920px;
    background: transparent;
    overflow: hidden;
    font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
  }
  .card-container {
    position: absolute;
    left: 0;
    top: 410px;
    width: 530px;
    background: #C81E1E;
    padding: 60px 48px;
    border-radius: 0 28px 28px 0;
    box-shadow: 10px 10px 35px rgba(0, 0, 0, 0.45);
  }
  .card-text {
    color: #FFFFFF;
    font-size: 43px;
    font-weight: 700;
    line-height: 1.22;
    letter-spacing: -0.015em;
  }
</style>
</head>
<body>
  <div class="card-container">
    <div class="card-text">${h.text}</div>
  </div>
</body>
</html>`;

  fs.writeFileSync(htmlFile, htmlContent, 'utf8');

  const fileUrl = 'file:///' + htmlFile.replace(/\\/g, '/');
  const args = [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--default-background-color=00000000',
    '--force-device-scale-factor=1',
    '--window-size=1080,1920',
    `--screenshot=${pngFile}`,
    fileUrl
  ];

  spawnSync(EDGE, args, { stdio: 'ignore' });
  const sz = fs.existsSync(pngFile) ? (fs.statSync(pngFile).size / 1024).toFixed(1) : 'FAIL';
  console.log(`Overlay Guion ${h.num}: ${sz} KB -> overlay_gancho_${h.num}.png`);
}
console.log('✅ 9 overlays completados.');
