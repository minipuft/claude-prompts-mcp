#!/usr/bin/env node
// Renders a shot from cached layer drawings (row 6.12, D87): the browser draws each DISTINCT drawing of each layer once, frames are composed from the cache, and a few frames are drawn
// by the browser whole and compared with the composed ones.
// usage: npm run render -- <shot-id> [--force] [--layers figure,props,world,light] [--confirm 8 | --confirm-frames 0,150,300] [--concurrency 4] [--no-video]
//   exit 0 rendered and every confirm frame inside the determinism tolerance (2 levels on at most 0.01 % of the pixels),
//        1 a confirm frame is beyond it (the frame and the layer owning the largest difference are named), 2 input error
// Writes: out/<shot>/render-manifest.json (layers: inputs hash, hit/miss, drawings, output hash; frames: drawing ids, camera, output hash; confirm: the comparison),
//         out/<shot>/render-report.json (wall times, not part of the record the gate reads), out/<shot>-seq/element-NNN.png (composed frames), out/<shot>-figure-seq/ (the figure layer alone,
//         what the probes read), out/<shot>-confirm/ (the browser's own frames), out/<shot>.mp4, and the cache out/cache/<shot>/<layer>/<inputsHash>/<drawing>.png.
// A layer is a HIT when every drawing it needs is already cached under its current inputs hash; a drawing is cached by the hash of what it draws, so an edit re-renders only the drawings it changes.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadTs, root} from './load-ts.mjs';
import {computeManifest, manifestDocument, sha256} from './render-manifest.mjs';

const args = process.argv.slice(2);
const shot = args.find((a) => !a.startsWith('--'));
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : fallback; };
if (!shot) { console.error('usage: render-cached.mjs <shot-id> [--force] [--layers a,b] [--confirm N] [--concurrency C] [--no-video]'); process.exit(2); }
const force = flag('force'), concurrency = Number(opt('concurrency', '4')), confirmCount = Number(opt('confirm', '8'));
const only = opt('layers', null)?.split(',');
const rel = (p) => path.relative(root, p);
const t0 = Date.now(), lap = () => Math.round((Date.now() - t0) / 100) / 10;
const timings = {};
const say = (s) => console.log(`[${String(lap()).padStart(6)} s] ${s}`);
const py = (cmd, job) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-'));
  const jobPath = path.join(dir, 'job.json'), resultPath = path.join(dir, 'result.json');
  fs.writeFileSync(jobPath, JSON.stringify(job));
  const run = spawnSync('python3', [path.join(root, 'scripts/animation/compose-layers.py'), cmd, jobPath, resultPath], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit']});
  if (run.status !== 0) { console.error(`compose-layers.py ${cmd} failed (exit ${run.status})`); process.exit(2); }
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  fs.rmSync(dir, {recursive: true, force: true});
  return result;
};
const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);
const writeIfChanged = (p, text) => { if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === text) return false; fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, text); return true; };

const m = await computeManifest(shot).catch((e) => { console.error(String(e.message ?? e)); process.exit(2); });
const cfg = m.config;
const outDir = path.join(root, 'out', shot), manifestPath = path.join(outDir, 'render-manifest.json');
const previous = readJson(manifestPath, null);
const SIZE = [1280, 720];
const composeVersion = sha256(fs.readFileSync(path.join(root, 'scripts/animation/compose-layers.py')));
const layerNames = ['figure', 'props', 'world', 'light'];
const selected = (l) => !only || only.includes(l);
if (only && only.some((l) => !layerNames.includes(l))) { console.error(`--layers names a layer this renderer does not draw: ${only.join(',')} (figure, props, world, light)`); process.exit(2); }

// ---- 1. what the cache has -------------------------------------------------------------------------------------------------------
const cacheDir = (layer) => path.join(root, 'out/cache', shot, layer, m.layers[layer].inputsHash.slice(0, 16));
const indexPath = (layer) => path.join(cacheDir(layer), 'index.json');
const indexes = Object.fromEntries(layerNames.map((l) => [l, readJson(indexPath(l), {})]));
const drawingPath = (layer, id) => path.join(cacheDir(layer), `${id}.png`);
const todo = [];
for (const layer of layerNames) {
  const L = m.layers[layer];
  L.counts = {drawings: L.drawings.length, reused: 0, rendered: 0};
  for (const d of L.drawings) {
    const cached = indexes[layer][d.id] && fs.existsSync(drawingPath(layer, d.id));
    if (cached && !(force && selected(layer))) { L.counts.reused++; d.outputHash = indexes[layer][d.id].sha256; }
    else todo.push({layer, id: d.id, pass: d.pass, p: L.projections[d.id]});
  }
}
if (only) {
  const missing = todo.filter((t) => !selected(t.layer));
  if (missing.length) { console.error(`--layers ${only.join(',')} leaves ${missing.length} drawings of ${[...new Set(missing.map((t) => t.layer))].join(', ')} uncached: render them (drop --layers) before composing`); process.exit(2); }
}
say(`${m.shot}: ${m.range[1] - m.range[0]} frames; ${layerNames.map((l) => `${l} ${m.layers[l].counts.drawings - todo.filter((t) => t.layer === l).length}/${m.layers[l].counts.drawings} cached`).join(', ')}`);

// ---- 2. the browser draws what is missing ------------------------------------------------------------------------------------------------
let browser = null, serveUrl = null, renderer = null;
const ensureBundle = async () => {
  if (serveUrl) return;
  const {bundle} = await import('@remotion/bundler');
  renderer = await import('@remotion/renderer');
  const key = sha256([m.codeVersion, m.layers.figure.inputsHash, m.layers.world.inputsHash].join(':')).slice(0, 16);
  const dir = path.join(root, 'out/cache', shot, 'bundle', key);
  const b0 = Date.now();
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    fs.rmSync(path.join(root, 'out/cache', shot, 'bundle'), {recursive: true, force: true});
    fs.mkdirSync(path.dirname(dir), {recursive: true});
    await bundle({entryPoint: path.join(root, 'src/index.ts'), outDir: dir, publicDir: path.join(root, 'public')});
    timings.bundleSeconds = (Date.now() - b0) / 1000;
    say(`bundled the renderer (${timings.bundleSeconds.toFixed(1)} s)`);
  } else say(`renderer bundle reused (${key})`);
  serveUrl = dir;
  browser = await renderer.openBrowser('chrome', {chromiumOptions: {gl: 'swangle'}, logLevel: 'error'});
};
const chromiumOptions = {gl: 'swangle'};
const renderFrames = async (compositionId, inputProps, frames, durationInFrames, onBuffer) => {
  await ensureBundle();
  const composition = await renderer.selectComposition({serveUrl, id: compositionId, inputProps, puppeteerInstance: browser, chromiumOptions, logLevel: 'error'});
  await renderer.renderFrames({
    composition: {...composition, durationInFrames: Math.max(durationInFrames, composition.durationInFrames)}, serveUrl, inputProps, imageFormat: 'png', concurrency, puppeteerInstance: browser, chromiumOptions, logLevel: 'error',
    frames, outputDir: null, onFrameBuffer: onBuffer, onStart: () => {}, onFrameUpdate: () => {},
  });
};

if (todo.length) {
  const r0 = Date.now();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'render-cached-'));
  const jobs = todo.map((t) => ({pass: t.pass, id: t.id, p: t.p}));
  say(`rendering ${todo.length} drawings through the browser (${[...new Set(todo.map((t) => t.layer))].map((l) => `${l} ${todo.filter((t) => t.layer === l).length}`).join(', ')})`);
  await renderFrames(cfg.layerComposition, {jobs}, jobs.map((_, i) => i), jobs.length, (buffer, frame) => { fs.writeFileSync(path.join(scratch, `${frame}.png`), buffer); });
  const items = todo.map((t, i) => ({id: `${t.layer}/${t.id}`, src: path.join(scratch, `${i}.png`), dst: drawingPath(t.layer, t.id)}));
  const got = py('ingest', {items, workers: 8}).items;
  for (const t of todo) {
    const entry = got[`${t.layer}/${t.id}`];
    indexes[t.layer][t.id] = entry;
    m.layers[t.layer].drawings.find((d) => d.id === t.id).outputHash = entry.sha256;
    m.layers[t.layer].counts.rendered++;
  }
  for (const layer of new Set(todo.map((t) => t.layer))) writeIfChanged(indexPath(layer), JSON.stringify(indexes[layer]) + '\n');
  fs.rmSync(scratch, {recursive: true, force: true});
  timings.drawingsSeconds = (Date.now() - r0) / 1000;
  say(`drew ${todo.length} drawings (${timings.drawingsSeconds.toFixed(1)} s)`);
}
for (const layer of layerNames) {
  const L = m.layers[layer];
  L.status = L.counts.rendered === 0 ? 'hit' : 'miss';
  L.outputHash = sha256(L.drawings.map((d) => d.outputHash).sort().join('\n'));
}
m.layers.camera.status = 'hit';
m.layers.camera.counts = {poses: new Set(m.frames.map((f) => JSON.stringify(f.camera))).size, frames: m.frames.length};
m.layers.camera.outputHash = sha256(m.frames.map((f) => JSON.stringify(f.camera)).join('\n'));

// ---- 3. compose every frame from the cache -------------------------------------------------------------------------------------------------
const {fieldAt, PASSES, PASS_LAYER} = await loadTs(cfg.passes);
const parseRgb = (s) => (s.startsWith('#') ? [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) : s.match(/[\d.]+/g).slice(0, 3).map(Number));
const figureField = parseRgb(fieldAt(0));
const layerOf = (pass) => PASS_LAYER[pass];
const frameFile = (dir, f) => path.join(root, 'out', dir, `element-${String(f).padStart(3, '0')}.png`);
const prevRows = new Map((previous?.frames ?? []).map((r) => [r.frame, r]));
const hashOf = (layer, id) => m.layers[layer].drawings.find((d) => d.id === id).outputHash;
const drawingIndex = new Map(layerNames.flatMap((l) => m.layers[l].drawings.map((d) => [`${l}/${d.id}`, d])));
const rows = m.frames.map((fr) => {
  const ids = PASSES.flatMap((pass) => fr.layers[layerOf(pass)].filter((id) => id.startsWith(`${pass}-`)).map((id) => ({pass, id, layer: layerOf(pass)})));
  const drawings = ids.map((d) => ({...d, path: drawingPath(d.layer, d.id), box: indexes[d.layer][d.id], hash: hashOf(d.layer, d.id)}));
  const field = parseRgb(fr.params.field);
  fr.composeKey = sha256(JSON.stringify([composeVersion, field, fr.params.grainOpacity, fr.params.titleOpacity, drawings.map((d) => [d.pass, d.hash])]));
  const figure = drawings.find((d) => d.pass === 'figure');
  fr.figureKey = sha256(JSON.stringify([composeVersion, figureField, figure.hash]));
  const prev = prevRows.get(fr.frame);
  return {
    frame: fr.frame, field, grainOpacity: fr.params.grainOpacity, titleOpacity: fr.params.titleOpacity, drawings,
    full: {path: frameFile(`${shot}-seq`, fr.frame), skipIfKey: prev?.composeKey === fr.composeKey ? prev.outputHash : null},
    figure: {path: frameFile(`${shot}-figure-seq`, fr.frame), skipIfKey: prev?.figureKey === fr.figureKey ? prev.figureHash : null},
  };
});
const c0 = Date.now();
const composed = py('compose', {size: SIZE, figureField, rows, workers: 8}).frames;
timings.composeSeconds = (Date.now() - c0) / 1000;
let wrote = 0;
for (const r of composed) {
  const fr = m.frames[r.frame - m.range[0]];
  if (r.kind === 'full') fr.outputHash = r.outputHash; else fr.figureHash = r.outputHash;
  if (r.wrote) wrote++;
}
say(`composed ${m.frames.length} frames + ${m.frames.length} figure-only frames: ${wrote} files written, ${2 * m.frames.length - wrote} already current (${timings.composeSeconds.toFixed(1)} s)`);

// ---- 4. the browser's own frames, and the comparison ----------------------------------------------------------------------------------------
const confirmFrames = opt('confirm-frames', null)?.split(',').map(Number) ?? (() => {
  const keys = readJson(path.join(root, `v3/keys/${shot}.json`), {keys: []}).keys.map((k) => k.frame);
  const picks = [...new Set([m.range[0], ...keys, m.range[1] - 1])].sort((a, b) => a - b);
  while (picks.length > confirmCount) {
    let at = 1, gap = Infinity;
    for (let i = 1; i < picks.length - 1; i++) if (picks[i] - picks[i - 1] < gap) { gap = picks[i] - picks[i - 1]; at = i; }
    picks.splice(at, 1);
  }
  return picks;
})();
const x0 = Date.now();
const browserKey = (fr) => sha256(JSON.stringify([m.codeVersion, ...layerNames.map((l) => m.layers[l].inputsHash), fr.frame, fr.layers, fr.camera, fr.params]));
const confirmDir = `${shot}-confirm`;
const prevConfirm = new Map((previous?.confirm?.frames ?? []).map((c) => [c.frame, c]));
const needBrowser = confirmFrames.filter((f) => {
  const fr = m.frames[f - m.range[0]], prev = prevConfirm.get(f), file = frameFile(confirmDir, f);
  return force || !(prev && prev.browserKey === browserKey(fr) && fs.existsSync(file) && sha256(fs.readFileSync(file)) === prev.browserHash);
});
if (needBrowser.length) {
  say(`drawing ${needBrowser.length} confirm frames whole through the browser (${needBrowser.join(', ')})`);
  fs.mkdirSync(path.join(root, 'out', confirmDir), {recursive: true});
  await renderFrames(cfg.composition, {}, needBrowser, m.range[1], (buffer, frame) => { fs.writeFileSync(frameFile(confirmDir, frame), buffer); });
}
const toCompare = confirmFrames.map((f) => ({frame: f, composed: frameFile(`${shot}-seq`, f), browser: frameFile(confirmDir, f), drawings: rows[f - m.range[0]].drawings}));
const compared = py('confirm', {rows: toCompare}).frames;
const confirm = {tolerance: {levels: 2, share: 0.0001}, frames: compared.map((c) => {
  const fr = m.frames[c.frame - m.range[0]];
  const {drawings, ...rest} = c;
  return {...rest, browserKey: browserKey(fr), browserHash: sha256(fs.readFileSync(frameFile(confirmDir, c.frame))), composeKey: fr.composeKey, ...(c.byLayer ? {byLayer: c.byLayer} : {})};
})};
timings.confirmSeconds = (Date.now() - x0) / 1000;
say(`confirm: ${confirm.frames.filter((c) => c.ok).length} of ${confirm.frames.length} frames inside the tolerance (${timings.confirmSeconds.toFixed(1)} s)`);
if (browser) await browser.close({silent: true}).catch(() => {});

// ---- 5. the video ---------------------------------------------------------------------------------------------------------------------
const mp4 = path.join(root, 'out', `${shot}.mp4`);
const changedFrames = wrote > 0 || !fs.existsSync(mp4);
if (!flag('no-video') && changedFrames) {
  const e0 = Date.now();
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(m.fps), '-start_number', String(m.range[0]), '-i', path.join(root, 'out', `${shot}-seq`, 'element-%03d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', mp4], {encoding: 'utf8'});
  if (ff.status !== 0) { console.error(`ffmpeg failed: ${ff.stderr}`); process.exit(2); }
  timings.encodeSeconds = (Date.now() - e0) / 1000;
  say(`encoded ${rel(mp4)} (${timings.encodeSeconds.toFixed(1)} s)`);
}

// ---- 6. the record --------------------------------------------------------------------------------------------------------------------
const doc = manifestDocument(m, {confirm});
const written = writeIfChanged(manifestPath, JSON.stringify(doc, null, 1) + '\n');
timings.wallSeconds = (Date.now() - t0) / 1000;
fs.writeFileSync(path.join(outDir, 'render-report.json'), JSON.stringify({shot, force, layers: only ?? 'all', concurrency, loadAverage: os.loadavg(), timings, drawingsRendered: todo.length, filesWritten: wrote, manifestWritten: written}, null, 1) + '\n');

console.log('\nlayer    status  drawings  reused  rendered  inputsHash');
for (const l of ['figure', 'props', 'world', 'light']) {
  const L = m.layers[l];
  console.log(`${l.padEnd(8)} ${L.status.toUpperCase().padEnd(7)} ${String(L.counts.drawings).padStart(8)} ${String(L.counts.reused).padStart(7)} ${String(L.counts.rendered).padStart(9)}  ${L.inputsHash.slice(0, 12)}`);
}
console.log(`camera   HIT     ${String(m.layers.camera.counts.poses).padStart(8)} poses over ${m.frames.length} frames  ${m.layers.camera.inputsHash.slice(0, 12)}`);
console.log('\nconfirm  frame   MAD      beyond 2 levels  allowance  largest  verdict');
for (const c of confirm.frames) console.log(`         ${String(c.frame).padStart(5)}  ${c.mad.toFixed(4).padStart(7)}  ${String(c.beyond).padStart(15)}  ${String(c.allowance).padStart(9)}  ${String(c.largest).padStart(7)}  ${c.ok ? 'ok' : `OVER (${c.worstLayer})`}`);
const over = confirm.frames.filter((c) => !c.ok);
say(`done in ${timings.wallSeconds.toFixed(1)} s; load average ${os.loadavg().map((v) => v.toFixed(1)).join(' ')}`);
if (over.length) {
  const w = [...over].sort((a, b) => b.beyond - a.beyond)[0];
  console.error(`\nrender refused: ${over.length} confirm frame(s) differ from the browser's own frame beyond the tolerance; worst frame ${w.frame} (${w.beyond} pixels beyond 2 levels, allowance ${w.allowance}), largest difference in the ${w.worstLayer} layer (${JSON.stringify(w.byLayer)})`);
  process.exit(1);
}
