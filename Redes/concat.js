const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dir = 'C:/Users/USUARIO/.gemini/antigravity/scratch/impulsa/Recursos/VIDEOS/30 GUIONES/Guion 01 La injusticia de la reseña negativa';
const out = 'C:/Users/USUARIO/.gemini/antigravity/scratch/impulsa/Redes/salida/Guion_01_Master.mp4';
const txt = 'C:/Users/USUARIO/.gemini/antigravity/scratch/impulsa/Redes/salida/list_g01.txt';

const files = ['Gancho 01.mp4', 'Dolor 01.mp4', 'Solucion 01.mp4', 'CTA 01.mp4'];
const list = files.map(f => `file '${dir}/${f}'`).join('\n');
fs.writeFileSync(txt, list, 'utf8');

const ffmpeg = 'E:/pinokio/bin/miniforge/Library/bin/ffmpeg.exe';
execSync(`"${ffmpeg}" -y -f concat -safe 0 -i "${txt}" -c copy "${out}"`, { stdio: 'inherit' });
console.log('Master created successfully. Size:', (fs.statSync(out).size / (1024 * 1024)).toFixed(2), 'MB');
