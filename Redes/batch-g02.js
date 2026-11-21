// Batch video generation for IMPULSA Guion 02, H3 Fused 4-Step — Frames, 544x960.
// One scene at a time, polls every 60s, copies finished MP4s into the Guion 02 folder.
// usage:  node batch-g02.js [--dry-run] [--force]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TMP = 'C:\\Users\\USUARIO\\AppData\\Local\\Temp\\opencode';
const CLIENT = path.join(TMP, 'mcp-client.js');
const FFPROBE = 'E:\\pinokio\\bin\\miniforge\\Library\\bin\\ffprobe.exe';
const RED = 'C:\\Users\\USUARIO\\.gemini\\antigravity\\scratch\\impulsa\\Redes';
const PROMPTS = path.join(RED, 'g02-video-prompts.json');
const LEDGER = path.join(RED, 'g02-jobs.json');
const LOG = path.join(RED, 'g02.log');
const G02_DIR = 'C:\\Users\\USUARIO\\.gemini\\antigravity\\scratch\\impulsa\\Recursos\\VIDEOS\\30 GUIONES\\Guion 02 Comparativa de eleccion en Google Maps';
const OUTPUTS = 'E:\\pinokio\\api\\Maestro.git\\app\\outputs';

const MODEL = 'minimax_h3_fused_turbo';
const RESOLUTION = '544x960';
const DURATION = 19;
const POLL_MS = 60000;

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const FORCE = argv.includes('--force');

const data = JSON.parse(fs.readFileSync(PROMPTS, 'utf8'));

function log(line) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const entry = `${stamp}  ${line}`;
  fs.appendFileSync(LOG, entry + '\r\n', 'utf8');
  console.log(entry);
}

function call(tool, payload, tag) {
  const f = path.join(TMP, `g02-${tag}.json`);
  fs.writeFileSync(f, JSON.stringify(payload, null, 2), 'utf8');
  const out = execFileSync('node', [CLIENT, tool, '@' + f], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const res = JSON.parse(out).result;
  if (res.isError) throw new Error(tool + ': ' + res.content[0].text);
  return res.structuredContent || JSON.parse(res.content[0].text);
}

let ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : {};
function saveLedger() {
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2), 'utf8');
}

function bestVideoFile(files) {
  let best = null, bestSize = -1;
  for (const f of files) {
    let size = -1;
    try { size = fs.statSync(path.join(OUTPUTS, f)).size; } catch (e) { continue; }
    if (size > bestSize) { bestSize = size; best = f; }
  }
  return best;
}

function probe(file) {
  const p = path.join(OUTPUTS, file);
  try {
    const out = execFileSync(FFPROBE, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,nb_frames',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1', p,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const get = (k) => {
      const m = out.match(new RegExp('^' + k + '=(.*)$', 'm'));
      return m ? m[1].trim() : null;
    };
    return { width: Number(get('width')), height: Number(get('height')), frames: Number(get('nb_frames')), duration: Number(get('duration')) };
  } catch (e) {
    return { error: String(e.message).slice(0, 200) };
  }
}

const queue = data.scenes.filter((s) => !(ledger[s.key] && ledger[s.key].state === 'done'));
for (const item of queue) {
  const okA = fs.existsSync(item.image_start);
  const okB = fs.existsSync(item.image_end);
  if (!okA || !okB) log(`MISSING REF ${item.key}: A=${okA} B=${okB}`);
}
if (!FORCE && queue.some((s) => !fs.existsSync(s.image_start) || !fs.existsSync(s.image_end))) {
  console.log('ABORT: reference images missing. Use --force to ignore.');
  process.exit(2);
}

log(`=== Guion 02 batch start === queue=${queue.length} ${RESOLUTION} ${DURATION}s`);

function submit(item) {
  const tag = `g02-${item.key}`;
  const ctx = call('get_creation_context', {
    body: {
      workflow: 'video.frames',
      brief: item.prompts[0].slice(0, 180),
      model_type: MODEL,
      duration_seconds: DURATION,
      resolution: RESOLUTION,
      params: {
        image_start: item.image_start,
        image_end: item.image_end,
        image_prompt_type: 'SE',
        image_mode: 0,
      },
    },
  }, tag + '-ctx');

  if (ctx.params.image_prompt_type !== 'SE') {
    throw new Error('context came back without image_prompt_type=SE, refusing to burn a job');
  }

  const plan = {
    context_id: ctx.context_id,
    windows: ctx.timeline.windows.map((w, i) => ({
      id: w.id,
      index: w.index,
      start_frame: w.start_frame,
      end_frame: w.end_frame,
      prompt: item.prompts[i] || item.prompts[item.prompts.length - 1],
      reference_ids: [],
      previous_window_id: w.previous_window_id,
    })),
  };

  const prep = call('prepare_authored_generation', {
    context_id: ctx.context_id,
    request_id: `${tag}-prep`,
    plan,
  }, tag + '-prep');

  const sub = call('submit_authored_generation', {
    prepared_id: prep.prepared_id,
    request_id: `${tag}-sub`,
  }, tag + '-sub');

  return { job_id: sub.job_id, frames: ctx.params.video_length, windows: ctx.timeline.window_count };
}

for (const item of queue) {
  const tag = `g02-${item.key}`;
  let r;
  try {
    r = submit(item);
  } catch (e) {
    ledger[item.key] = { part: item.part, state: 'error', error: String(e.message).slice(0, 400) };
    saveLedger();
    log(`SUBMIT FAILED ${item.key}: ${String(e.message).slice(0, 300)}`);
    continue;
  }
  ledger[item.key] = {
    part: item.part,
    out_name: item.out_name,
    state: 'running',
    job_id: r.job_id,
    frames: r.frames,
    windows: r.windows,
    submitted: new Date().toISOString(),
  };
  saveLedger();
  log(`submitted ${item.key} (${item.part}) job=${r.job_id} frames=${r.frames} windows=${r.windows}`);

  // wait for completion before next submit (GPU serializes anyway)
  for (;;) {
    const sleepMs = POLL_MS;
    const end = Date.now() + sleepMs;
    while (Date.now() < end) { /* hold */ }
    let j;
    try {
      j = call('get_job', { job_id: r.job_id }, tag + '-poll');
    } catch (e) {
      log(`poll error ${item.key}: ${String(e.message).slice(0, 200)}`);
      continue;
    }
    const st = String(j.status || 'unknown');
    if (/completed|done/i.test(st)) {
      const files = j.output_files || [];
      const file = bestVideoFile(files);
      const info = file ? probe(file) : { error: 'no output file on disk' };
      const pm = j.performance_measurements || {};
      ledger[item.key] = {
        ...ledger[item.key],
        state: 'done',
        file,
        width: info.width || null,
        height: info.height || null,
        frames_out: info.frames || null,
        duration: info.duration || null,
        elapsed_seconds: pm.elapsed_seconds || null,
        finished: new Date().toISOString(),
      };
      saveLedger();
      log(`DONE ${item.key} (${item.part}) ${Math.round(pm.elapsed_seconds || 0)}s ${info.width}x${info.height} ${info.frames_out}f ${file}`);
      // copy into the Guion 02 folder with the friendly name
      try {
        fs.mkdirSync(G02_DIR, { recursive: true });
        fs.copyFileSync(path.join(OUTPUTS, file), path.join(G02_DIR, item.out_name));
        log(`copied -> ${path.join(G02_DIR, item.out_name)}`);
      } catch (e) {
        log(`COPY FAILED ${item.key}: ${String(e.message).slice(0, 200)}`);
      }
      break;
    } else if (/failed|error|cancelled|canceled/i.test(st)) {
      ledger[item.key] = { ...ledger[item.key], state: 'failed', error: JSON.stringify(j.error || '').slice(0, 300) };
      saveLedger();
      log(`FAILED ${item.key} job=${r.job_id}`);
      break;
    } else {
      ledger[item.key].progress = j.progress;
      ledger[item.key].message = j.message;
      saveLedger();
      log(`tick ${item.key} progress=${j.progress} ${j.message || ''}`.slice(0, 160));
    }
  }
}

const all = Object.values(ledger);
log(`=== Guion 02 batch complete === done=${all.filter((v) => v.state === 'done').length} failed=${all.filter((v) => v.state === 'failed').length}`);
