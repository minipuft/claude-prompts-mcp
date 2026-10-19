#!/usr/bin/env node
// Compiles the production bible (D94): the film's pacing, script, blocking, camera, keys, light, colour script, look and proposals joined on
// one frame axis. v3/bible.json is a projection of the files it declares in `generatedFrom`; it is copied, never edited.
// Shape (showcase.bible.1, OpenTimelineIO-shaped): {schema, fps, duration, generatedFrom, inputsHash, tracks:[{name, items:[{start,end,beat,label,data}]}], flags:[{beat,text}]}.
// Extra keys: `revision` (the ledger's own revision string), `unanchored` (rulings that close no proposal: not timed, so not on a lane) and `materials` (v3/materials.json as it is: not timed either,
// so a table under the flags rather than a lane; its schema is hashed with it because the schema owns the ranges the probe judges it by).
// The spec's rulings list is also mirrored machine-readably into v3/rulings.json (D95 row 7.8): [{id, ids, who, date, text, closes, raw}].
// usage: node scripts/animation/compile-bible.mjs [--ledger v3/beats-v2.json] [--timeline v3/timeline.json] [--xsheet v3/xsheet.json]
//        [--light v3/light.json] [--frames out/animatic-seq] [--out v3/bible.json] [--spec v3/creative-spec.md] [--rulings-out v3/rulings.json]
import crypto from 'node:crypto';
import fs from 'node:fs';
import {parseRuling as parseRulingForm} from './rulings.mjs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..', '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const abs = (p) => path.resolve(root, p);
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
const fail = (msg) => {
  console.error(`compile-bible: ${msg}`);
  process.exit(1);
};

// ---------- the declared inputs, in hash order ----------
const listJson = (dir) =>
  fs.existsSync(abs(dir)) ? fs.readdirSync(abs(dir)).filter((f) => f.endsWith('.json')).sort().map((f) => `${dir}/${f}`) : [];
const ledgerPath = abs(arg('ledger', 'v3/beats-v2.json'));
const timelinePath = abs(arg('timeline', 'v3/timeline.json'));
const xsheetPath = abs(arg('xsheet', 'v3/xsheet.json'));
const lightPath = abs(arg('light', 'v3/light.json'));
const framesDir = abs(arg('frames', 'out/animatic-seq'));
const outPath = abs(arg('out', 'v3/bible.json'));
const specPath = abs(arg('spec', 'v3/creative-spec.md'));
const rulingsOutPath = abs(arg('rulings-out', 'v3/rulings.json'));
const inputs = [
  ledgerPath,
  timelinePath,
  xsheetPath,
  lightPath,
  ...listJson('v3/blocking').map(abs),
  abs('v3/references/board.json'),
  abs('v3/references/owner/picks.json'),
  abs('v3/script.md'),
  specPath,
  ...listJson('v3/proposals').map(abs),
  abs('v3/materials.json'),
  abs('v3/materials.schema.json'),
];
for (const p of inputs) if (!fs.existsSync(p)) fail(`declared input ${rel(p)} does not exist`);
const bytes = new Map(inputs.map((p) => [p, fs.readFileSync(p)]));
const hash = crypto.createHash('sha256');
for (const p of inputs) hash.update(bytes.get(p));
const inputsHash = hash.digest('hex');
const json = (p) => JSON.parse(bytes.get(p).toString('utf8'));

const ledger = json(ledgerPath);
const timeline = json(timelinePath);
const xsheet = json(xsheetPath);
const light = json(lightPath);
const board = json(abs('v3/references/board.json'));
const picks = json(abs('v3/references/owner/picks.json'));
const script = bytes.get(abs('v3/script.md')).toString('utf8');
const specText = bytes.get(specPath).toString('utf8');
const materials = json(abs('v3/materials.json'));
const blockingFiles = listJson('v3/blocking').map((p) => json(abs(p)));
const proposalFiles = listJson('v3/proposals').map((p) => ({file: p, ...json(abs(p))}));

const fps = timeline.fps;
const duration = timeline.durationInFrames;
const beats = timeline.beats;
const ledgerBeat = (id) => ledger.beats.find((b) => b.id === id) || {};
const beatOfFrame = (f) => beats.find((b) => f >= b.start && f < b.end);
const flags = [];
const flag = (beat, text) => flags.push({beat, text});

// ---------- pacing ----------
const pacing = beats.map((tb) => {
  const lb = ledgerBeat(tb.id);
  if (lb.seconds !== undefined && Math.round(lb.seconds * fps) !== tb.frames) {
    flag(tb.id, `timeline stale: the ledger says ${lb.seconds} s (${Math.round(lb.seconds * fps)} frames), the timeline gives ${tb.frames}; run compile-timeline.mjs`);
  }
  return {
    start: tb.start,
    end: tb.end,
    beat: tb.id,
    label: `${tb.index + 1}. ${tb.id}`,
    data: {
      seconds: lb.seconds ?? tb.frames / fps,
      register: lb.register ?? '',
      light_pushes: lb.light_pushes ?? '',
      transitions: {in: lb.transition_in ?? tb.transitionIn ?? '', out: lb.transition_out ?? tb.transitionOut ?? ''},
      actions: (lb.actions || []).map((a) => `${a.actor}: ${a.does}`),
      asks: lb.asks || [],
    },
  };
});

// ---------- script ----------
// script.md keeps the six beats of the first spine; a heading that names more than one ledger beat says so here (one place, no guessing).
const HEADING_BEATS = {scaffold: ['art-world', 'crossing', 'programming-world'], settle: ['home-settle']};
const slug = (s) => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sections = [];
{
  const re = /^###\s+(\d+)\.\s+(.+?)\s*(?:\((\d+)[–-](\d+)\))?(?:\s+·.*)?$/;
  let cur = null;
  for (const line of script.split('\n')) {
    const m = re.exec(line);
    if (line.startsWith('## ') && !line.startsWith('###')) cur = null;
    if (line.startsWith('### ')) {
      cur = m ? {number: Number(m[1]), name: m[2], range: m[3] ? [Number(m[3]), Number(m[4])] : null, lines: []} : null;
      if (cur) sections.push(cur);
      continue;
    }
    if (cur) cur.lines.push(line);
  }
}
const sectionFor = (id) =>
  sections.find((s) => (HEADING_BEATS[slug(s.name)] || [slug(s.name)]).includes(id)) || null;
const scriptTrack = beats.map((tb) => {
  const s = sectionFor(tb.id);
  if (!s) {
    flag(tb.id, 'script.md has no section for this beat');
    return {start: tb.start, end: tb.end, beat: tb.id, label: 'no script section', data: {prose: '', notes: []}};
  }
  const body = s.lines.join('\n').trim();
  const notes = body.split('\n').filter((l) => /^\*.*\*$/.test(l.trim())).map((l) => l.trim().replace(/^\*|\*$/g, ''));
  const sharedWith = (HEADING_BEATS[slug(s.name)] || []).filter((id) => id !== tb.id);
  return {
    start: tb.start,
    end: tb.end,
    beat: tb.id,
    label: `${s.number}. ${s.name}`,
    data: {
      heading: `${s.number}. ${s.name}`,
      headingRange: s.range ? s.range.join('–') : null,
      headingRangeMatchesTimeline: s.range ? s.range[0] === tb.start && s.range[1] === tb.end : null,
      sharedWith,
      notes,
      prose: body,
    },
  };
});
for (const s of sections) {
  if (!beats.some((tb) => (HEADING_BEATS[slug(s.name)] || [slug(s.name)]).includes(tb.id))) flag(slug(s.name), `script.md section "${s.name}" names no beat on the timeline`);
}

// ---------- blocking ----------
const blocking = beats.map((tb) => {
  const b = blockingFiles.find((f) => f.id === tb.id || f.beat === tb.id);
  if (!b) {
    flag(tb.id, 'no blocking file for this beat');
    return {start: tb.start, end: tb.end, beat: tb.id, label: 'no blocking', data: {missing: true}};
  }
  return {
    start: tb.start,
    end: tb.end,
    beat: tb.id,
    label: b.provisional ? `${tb.id} (provisional)` : tb.id,
    data: {
      provisional: !!b.provisional,
      figure: b.figure ?? null,
      codex: b.codex ?? null,
      clawd: b.clawd ?? null,
      emitter: b.emitter ?? null,
      card: b.card ?? null,
    },
  };
});

// ---------- xsheet: camera, keys ----------
const rows = xsheet.rows;
const staleBeats = new Set();
if (rows.length !== duration) staleBeats.add('*');
for (const r of rows) {
  const tb = beatOfFrame(r.frame);
  if (!tb || tb.id !== r.beat) staleBeats.add(tb ? tb.id : '*');
}
for (const id of staleBeats) {
  flag(id === '*' ? beats[0].id : id, `xsheet stale: ${rows.length} rows against a ${duration}-frame timeline, rows name other beats than the timeline at their frames; run npm run xsheet`);
}
const camOf = (r) => {
  const c = r.camera;
  return {x: c.x, y: c.y, zoom: c.zoom, rot: c.rot ?? c.rotation ?? 0};
};
const sameCam = (a, b) => a.x === b.x && a.y === b.y && a.zoom === b.zoom && a.rot === b.rot;
const camera = [];
for (const r of rows) {
  const tb = beatOfFrame(r.frame);
  const beatId = tb ? tb.id : r.beat;
  const pose = camOf(r);
  const last = camera[camera.length - 1];
  if (last && last.beat === beatId && sameCam(last.data.pose, pose) && last.end === r.frame) last.end = r.frame + 1;
  else camera.push({start: r.frame, end: r.frame + 1, beat: beatId, label: '', data: {pose, description: ledgerBeat(beatId).camera ?? tb?.camera ?? ''}});
}
for (const it of camera) {
  const p = it.data.pose;
  it.label = `zoom ${p.zoom} at (${p.x}, ${p.y})${p.rot ? ` rot ${p.rot}` : ''}`;
}
const keys = [];
{
  const keyRows = rows.filter((r) => r.key);
  keyRows.forEach((r, i) => {
    const tb = beatOfFrame(r.frame);
    const beatEnd = tb ? tb.end : duration;
    const next = keyRows[i + 1];
    const end = next && next.frame < beatEnd ? next.frame : beatEnd;
    keys.push({
      start: r.frame,
      end,
      beat: tb ? tb.id : r.beat,
      label: r.key,
      data: {hold: r.hold ?? null, breakdowns: rows.filter((x) => x.breakdown && x.frame >= r.frame && x.frame < end).length},
    });
  });
}

// ---------- light, colour script ----------
const lightTrack = beats.map((tb) => {
  const lt = light.beats[tb.id];
  if (!lt) {
    flag(tb.id, 'light.json has no entry for this beat');
    return {start: tb.start, end: tb.end, beat: tb.id, label: 'no light', data: {missing: true}};
  }
  const e = lt.emitter;
  return {
    start: tb.start,
    end: tb.end,
    beat: tb.id,
    label: e ? `${e.anchor} · ${e.intensity}` : `no emitter · ${lt.radiance}`,
    data: {
      pair: lt.pair ?? null,
      emitter: e ? {anchor: e.anchor, path: {from: e.start, to: e.end}, intensity: e.intensity, colour: e.colour, on: e.on, off: e.off} : null,
      radiance: lt.radiance ?? '',
      grain: lt.grain ?? '',
    },
  };
});
const frameName = (f) => `element-${String(f).padStart(4, '0')}.png`;
const colourScript = beats.map((tb) => {
  const lt = light.beats[tb.id] || {};
  const mid = Math.floor((tb.start + tb.end) / 2);
  const file = path.join(framesDir, frameName(mid));
  return {
    start: tb.start,
    end: tb.end,
    beat: tb.id,
    label: lt.pair ? `${lt.pair.radiance} / ${lt.pair.accent}` : 'no pair',
    data: {radiance: lt.pair?.radiance ?? null, accent: lt.pair?.accent ?? null, midFrame: mid, animaticFrame: fs.existsSync(file) ? rel(file) : null},
  };
});

// ---------- look ----------
const look = beats.map((tb) => ({start: tb.start, end: tb.end, beat: tb.id, label: tb.world, data: {world: tb.world, worldRaw: tb.worldRaw ?? tb.world}}));
for (const c of timeline.crossings || []) {
  const lc = (light.crossings || []).find((x) => x.from === c.from && x.to === c.to);
  look.push({
    start: c.start,
    end: c.end,
    beat: c.from,
    label: `${c.from}>${c.to}`,
    data: {crossing: true, from: c.from, to: c.to, fromWorld: c.fromWorld, toWorld: c.toWorld, length: c.length, split: c.split, path: lc?.path ?? null},
  });
}
look.sort((a, b) => a.start - b.start || a.end - b.end);

// ---------- proposals ----------
const cardIndex = new Map();
for (const sec of board.sections) for (const c of sec.cards) cardIndex.set(c.id, {kind: 'board card', section: sec.title, title: c.title, borrow: c.borrow ?? '', governs: c.governs ?? ''});
for (const p of picks.picks) if (!cardIndex.has(p.id)) cardIndex.set(p.id, {kind: 'owner pick', section: p.section, title: p.id, borrow: p.why ?? '', governs: ''});
const proposals = proposalFiles.map((p) => {
  const a = p.anchor || {};
  let start;
  let end;
  let beatId = a.beat ?? null;
  if (Array.isArray(a.frames)) [start, end] = a.frames;
  else if (typeof a.frame === 'number') [start, end] = [a.frame, a.frame + 1];
  else if (Array.isArray(a.beats)) {
    const first = beats.find((b) => b.id === a.beats[0]);
    const lastB = beats.find((b) => b.id === a.beats[1]);
    start = first ? first.start : NaN;
    end = lastB ? lastB.end : NaN;
    beatId = a.beats[0];
  } else {
    const tb = beats.find((b) => b.id === a.beat);
    start = tb ? tb.start : NaN;
    end = tb ? tb.end : NaN;
  }
  if (Number.isNaN(start) || Number.isNaN(end)) flag(beatId ?? '?', `proposal ${p.id} is anchored to a beat the timeline does not have`);
  const refs = (p.references || []).map((id) => {
    const hit = cardIndex.get(id);
    if (!hit) flag(beatId ?? '?', `proposal ${p.id} cites reference "${id}", which is on neither the board nor the owner picks`);
    return hit ? {id, ...hit} : {id, kind: 'unresolved'};
  });
  return {
    start,
    end,
    beat: beatId,
    label: `${p.id} ${p.title ?? ''}`.trim(),
    data: {
      id: p.id,
      title: p.title ?? '',
      kind: p.kind,
      status: p.status,
      from: p.from,
      date: p.date ?? null,
      ruling: p.ruling ?? null,
      anchor: a,
      text: p.text ?? '',
      references: refs,
      before: p.before ?? null,
      after: p.after ?? null,
      file: p.file,
    },
  };
});

// ---------- rulings: the spec's rulings list, mirrored ----------
// A bullet is `- DNN, <who>, <date>[ (...)][, suffix]: <text>`; some carry a parenthetical before the colon (`D38 (carried):`), some name two rulings (`D35/D36`).
// Parsed leniently: the header is everything before the first colon outside parentheses; the raw bullet is kept.
const headerColon = (line) => {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ':' && depth === 0 && line[i + 1] === ' ') return i;
  }
  return -1;
};
// The ruling form (D96) is parsed by scripts/animation/rulings.mjs; its output is a superset of the mirror's older fields.
const parseRuling = (raw) => ({...parseRulingForm(raw), raw});
const rulings = specText.split('\n').filter((l) => /^- D\d+/.test(l)).map(parseRuling);
for (const r of rulings) {
  for (const p of proposalFiles) if (p.ruling && (r.ids.includes(p.ruling) || p.ruling === r.id) && !r.closes.includes(p.id)) r.closes.push(p.id);
  r.closes.sort();
}
const proposalItem = (pid) => proposals.find((x) => x.data.id === pid);
const rulingsItems = [];
const unanchored = [];
for (const r of rulings) {
  const hits = r.closes.map(proposalItem).filter((x) => x && x.beat && beats.some((b) => b.id === x.beat));
  const entry = {id: r.id, ids: r.ids, who: r.who, date: r.date, closes: r.closes, text: r.text};
  if (!hits.length) {
    unanchored.push(entry);
    continue;
  }
  const tb = beats.find((b) => b.id === hits[0].beat);
  rulingsItems.push({start: tb.start, end: tb.end, beat: tb.id, label: r.ids.join('/'), data: entry});
}
fs.writeFileSync(rulingsOutPath, JSON.stringify(rulings, null, 2) + '\n');

// ---------- flags: the edit sheet's four ----------
for (const tb of beats) {
  const lb = ledgerBeat(tb.id);
  const br = rows.filter((r) => beatOfFrame(r.frame)?.id === tb.id);
  const ks = br.filter((r) => r.key);
  const bd = br.filter((r) => r.breakdown).length;
  const held = br.filter((r) => r.phase === 'hold').length;
  if (ks.length === 0) flag(tb.id, 'no keys: the figure is not posed in this beat');
  if (br.length && held / br.length > 0.9) flag(tb.id, `held ${Math.round((100 * held) / br.length)} % of the beat (over 90 %): nothing moves`);
  if (ks.length > 1 && bd === 0) flag(tb.id, 'no breakdowns between keys: straight inbetweens');
  for (const ask of lb.asks || []) flag(tb.id, `plot ask open: ${ask}`);
}

const bible = {
  schema: 'showcase.bible.1',
  revision: ledger.revision ?? '',
  fps,
  duration,
  generatedFrom: inputs.map(rel),
  inputsHash,
  tracks: [
    {name: 'pacing', items: pacing},
    {name: 'script', items: scriptTrack},
    {name: 'blocking', items: blocking},
    {name: 'camera', items: camera},
    {name: 'keys', items: keys},
    {name: 'light', items: lightTrack},
    {name: 'colour-script', items: colourScript},
    {name: 'look', items: look},
    {name: 'proposals', items: proposals},
    {name: 'rulings', items: rulingsItems},
  ],
  unanchored,
  materials,
  flags,
};
fs.mkdirSync(path.dirname(outPath), {recursive: true});
fs.writeFileSync(outPath, JSON.stringify(bible, null, 2) + '\n');
const itemCount = bible.tracks.reduce((n, t) => n + t.items.length, 0);
console.log(`bible: ${beats.length} beats, ${bible.tracks.length} tracks, ${itemCount} items, ${flags.length} flags, ${rulings.length} rulings (${rulingsItems.length} on the lane, ${unanchored.length} unanchored), hash ${inputsHash.slice(0, 12)} -> ${rel(outPath)}`);
