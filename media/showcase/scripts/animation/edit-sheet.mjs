#!/usr/bin/env node
// The edit sheet (D90): the whole script on one page so pacing and impact can be judged and edited.
// Reads v3/beats-v2.json (seconds, actions, register, light_pushes, asks), v3/timeline.json (frames),
// v3/light.json (emitter), v3/xsheet.json (keys and holds per beat) and one frame per beat from the latest animatic.
// Writes v3/edit-sheet.json (data) and out/edit-sheet.html (the page the owner reads).
// usage: node scripts/animation/edit-sheet.mjs [--frames out/animatic-seq] [--animatic animatic-03]
//        [--out out/edit-sheet.html] [--json v3/edit-sheet.json]
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..', '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const framesDir = path.resolve(root, arg('frames', 'out/animatic-seq'));
const animaticName = arg('animatic', path.basename(framesDir));
const outHtml = path.resolve(root, arg('out', 'out/edit-sheet.html'));
const outJson = path.resolve(root, arg('json', 'v3/edit-sheet.json'));
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

const ledger = read('v3/beats-v2.json');
const timeline = read('v3/timeline.json');
const light = read('v3/light.json');
const xsheet = read('v3/xsheet.json');
const fps = timeline.fps;

const guideOf = (beat) => {
  const g = (beat.actions || []).filter((a) => a.actor !== 'human' && /guide|leads|hands|takes the lead/i.test(a.does)).map((a) => a.actor);
  return [...new Set(g)].join(' + ') || '';
};

const frameFile = (f) => {
  const name = `element-${String(f).padStart(4, '0')}.png`;
  return fs.existsSync(path.join(framesDir, name)) ? path.relative(path.dirname(outHtml), path.join(framesDir, name)) : null;
};

const beats = timeline.beats.map((tb) => {
  const lb = ledger.beats.find((b) => b.id === tb.id) || {};
  const rows = xsheet.rows.filter((r) => r.beat === tb.id);
  const keys = rows.filter((r) => r.key);
  const holds = keys.map((k) => k.hold).filter((h) => typeof h === 'number');
  const breakdowns = rows.filter((r) => r.breakdown).length;
  const held = rows.filter((r) => r.phase === 'hold').length;
  const lt = light.beats[tb.id] || {};
  const mid = Math.floor((tb.start + tb.end) / 2);
  return {
    id: tb.id,
    index: tb.index,
    world: tb.world,
    seconds: lb.seconds,
    start: tb.start,
    end: tb.end,
    frames: tb.frames,
    guide: guideOf(lb),
    register: lb.register || '',
    lightPushes: lb.light_pushes || '',
    camera: lb.camera || tb.camera || '',
    emitter: lt.emitter ? {anchor: lt.emitter.anchor, intensity: lt.emitter.intensity, colour: lt.emitter.colour} : null,
    pair: lt.pair || null,
    radiance: lt.radiance || '',
    actions: (lb.actions || []).map((a) => `${a.actor}: ${a.does}`),
    transitionIn: lb.transition_in || tb.transitionIn || '',
    transitionOut: lb.transition_out || tb.transitionOut || '',
    asks: lb.asks || [],
    references: lb.references || [],
    keys: keys.map((k) => ({frame: k.frame, key: k.key, hold: k.hold})),
    keyCount: keys.length,
    breakdowns,
    holdFrames: held,
    holdShare: rows.length ? Math.round((100 * held) / rows.length) : null,
    longestHold: holds.length ? Math.max(...holds) : null,
    flags: [
      keys.length === 0 ? 'no keys: the figure is not posed in this beat' : null,
      rows.length && held / rows.length > 0.9 ? 'held over 90 % of the beat: nothing moves' : null,
      keys.length && breakdowns === 0 && keys.length > 1 ? 'no breakdowns between keys: straight inbetweens' : null,
      (lb.asks || []).length ? 'plot ask open' : null,
    ].filter(Boolean),
    frameAt: {first: frameFile(tb.start), mid: frameFile(mid), last: frameFile(tb.end - 1)},
    midFrame: mid,
  };
});

// what a one-second change to this beat does to every later beat: the shift is the rule the owner edits with
const shifts = beats.map((b) => ({id: b.id, laterBeatsShiftBy: fps, laterBeats: beats.filter((x) => x.index > b.index).map((x) => x.id)}));
const total = beats.reduce((n, b) => n + b.frames, 0);
const data = {
  revision: `edit-sheet · ${new Date().toISOString().slice(0, 10)} · animatic ${animaticName} · D90`,
  fps,
  durationInFrames: total,
  seconds: total / fps,
  animatic: animaticName,
  rulings: ['D88 register', 'D89 whose film', 'D90 this sheet', 'D91 light leads composition', 'D92 timing references'],
  beats,
  shifts,
  crossings: timeline.crossings || [],
};
fs.writeFileSync(outJson, JSON.stringify(data, null, 2) + '\n');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const regClass = (r) => (/reverent/.test(r) ? 'rev' : /gag|comic/.test(r) ? 'gag' : /focus/.test(r) ? 'foc' : 'warm');
const bar = beats
  .map(
    (b) =>
      `<div class="seg ${regClass(b.register)}" style="flex:${b.frames}" title="${esc(b.id)} ${b.start}-${b.end}"><span>${esc(b.id)}</span><small>${b.seconds}s</small></div>`,
  )
  .join('');
const rows = beats
  .map((b) => {
    const img = (f, label) => (f ? `<figure><img src="${esc(f)}" alt="${esc(b.id)} ${label}"><figcaption>${label}</figcaption></figure>` : `<figure class="none">${label}: no frame</figure>`);
    return `<section class="beat ${regClass(b.register)}" id="${esc(b.id)}">
<header><h2>${b.index + 1}. ${esc(b.id)}</h2><div class="meta"><b>${b.seconds} s</b> · frames ${b.start}–${b.end} · world <b>${esc(b.world)}</b>${b.guide ? ` · guide <b>${esc(b.guide)}</b>` : ''}</div></header>
<div class="frames">${img(b.frameAt.first, `first ${b.start}`)}${img(b.frameAt.mid, `mid ${b.midFrame}`)}${img(b.frameAt.last, `last ${b.end - 1}`)}</div>
<dl>
<dt>Register (D88)</dt><dd>${esc(b.register)}</dd>
<dt>The light pushes (D91)</dt><dd>${esc(b.lightPushes)}${b.emitter ? `<br><small>emitter: ${esc(b.emitter.anchor)} · intensity ${b.emitter.intensity} · ${esc(b.emitter.colour)}${b.pair ? ` · pair ${esc(b.pair.radiance)} / ${esc(b.pair.accent)}` : ''} · ${esc(b.radiance)}</small>` : ''}</dd>
<dt>Camera</dt><dd>${esc(b.camera)}</dd>
<dt>Actions</dt><dd><ul>${b.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></dd>
<dt>Keys and holds</dt><dd>${b.keyCount} keys, ${b.breakdowns} breakdowns · held ${b.holdShare ?? '?'} % of the beat${b.longestHold ? ` · longest hold ${b.longestHold} f` : ''}<br><small>${b.keys.map((k) => `${k.key}@${k.frame}${k.hold ? ` (hold ${k.hold})` : ''}`).join(' · ')}</small></dd>
${b.flags.length ? `<dt class="flag">Flags</dt><dd class="flag">${b.flags.map(esc).join('<br>')}</dd>` : ''}
<dt>In / out</dt><dd>${esc(b.transitionIn)}<br>${esc(b.transitionOut)}</dd>
${b.asks.length ? `<dt class="ask">Asked of the owner</dt><dd class="ask">${b.asks.map(esc).join('<br>')}</dd>` : ''}
<dt>If this beat changes by one second</dt><dd><small>every later beat moves by ${fps} frames: ${shifts[b.index].laterBeats.join(', ') || 'none'}</small></dd>
</dl></section>`;
  })
  .join('\n');

const html = `<!doctype html><meta charset="utf-8"><title>Edit sheet · ${esc(data.revision)}</title>
<style>
body{background:#111;color:#eee;font:14px/1.45 system-ui,sans-serif;margin:0;padding:24px 32px}
h1{font-weight:500;margin:0 0 4px}.sub{color:#999;margin-bottom:18px}
.bar{display:flex;height:54px;border-radius:6px;overflow:hidden;margin:12px 0 28px;gap:2px}
.seg{display:flex;flex-direction:column;justify-content:center;align-items:center;min-width:0;color:#111;font-size:12px}
.seg span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:95%}.seg small{opacity:.7}
.warm{background:#f0b35a}.rev{background:#8fb7ff}.gag{background:#f58a7a}.foc{background:#c9c9c9}
.beat{display:grid;grid-template-columns:1fr;border-left:6px solid;padding:10px 18px;margin:0 0 22px;background:#181818;border-radius:0 8px 8px 0}
.beat.warm{border-color:#f0b35a}.beat.rev{border-color:#8fb7ff}.beat.gag{border-color:#f58a7a}.beat.foc{border-color:#c9c9c9}
.beat h2{margin:0;font-size:18px;font-weight:600}.meta{color:#aaa;margin:2px 0 10px}
.frames{display:flex;gap:10px;margin-bottom:12px}figure{margin:0}figure img{width:300px;border-radius:4px;display:block}figcaption{color:#888;font-size:12px}figure.none{width:300px;height:169px;background:#222;color:#666;display:grid;place-items:center;border-radius:4px}
dl{display:grid;grid-template-columns:190px 1fr;gap:4px 14px;margin:0}dt{color:#999}dd{margin:0}ul{margin:0;padding-left:18px}small{color:#aaa}
.ask{color:#ffd37a}.flag{color:#ff8f8f}
</style>
<h1>Edit sheet</h1><div class="sub">${esc(data.revision)} · ${beats.length} beats · ${total} frames · ${data.seconds} s at ${fps} fps · colours: amber warm/playful, blue reverent, coral gag, grey focus. Edit <code>v3/beats-v2.json</code> (seconds, register, light_pushes), then <code>compile-timeline.mjs</code> and this script.</div>
<div class="bar">${bar}</div>
${rows}`;
fs.mkdirSync(path.dirname(outHtml), {recursive: true});
fs.writeFileSync(outHtml, html);
console.log(`edit-sheet: ${beats.length} beats, ${total} frames -> ${path.relative(root, outJson)}, ${path.relative(root, outHtml)}`);
