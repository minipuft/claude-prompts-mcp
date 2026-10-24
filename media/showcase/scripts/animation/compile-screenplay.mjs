#!/usr/bin/env node
// Compiles the screenplay (p014): v3/screenplay.json is the source; this renders v3/screenplay.md (the reader's screenplay with the colour strip) and v3/screenplay.fountain (plain Fountain, the
// pipeline's screenplay format) from it, and writes each story point's `shot` back into the json so the join is explicit.
//
// The pipeline id of a story point is `<shot>/<sp-id>` (`s02/sp-4.3`): the shot is the id of v3/shots.json whose `frames` range [start, end) holds the story point's frame. The ranges are the beats of
// v3/timeline.json each shot covers (probe-screenplay.py checks they tile the timeline). A frame in no shot, or in two, is written as `shot: null` and named on stderr (exit 1 after the files are
// written); probe-screenplay.py refuses it.
//
// Both renders carry a first line `generated from screenplay.json ... source <hash> body <hash>`: the source hash covers screenplay.json and beats-v2.json, the body hash everything after the first line,
// so probe-screenplay.py refuses a render older than its source and a render edited by hand. One model (`scenes`) feeds both renders; the story point's prose is the json's own `action`.
// usage: node scripts/animation/compile-screenplay.mjs [--screenplay v3/screenplay.json] [--out-md v3/screenplay.md] [--out-fountain v3/screenplay.fountain]
import crypto from 'node:crypto';
import fs from 'node:fs';
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
  console.error(`compile-screenplay: ${msg}`);
  process.exit(1);
};
const sha = (...parts) => crypto.createHash('sha256').update(parts.join('\n')).digest('hex');

const screenplayPath = abs(arg('screenplay', 'v3/screenplay.json'));
const mdPath = abs(arg('out-md', 'v3/screenplay.md'));
const fountainPath = abs(arg('out-fountain', 'v3/screenplay.fountain'));
const ledgerPath = abs('v3/beats-v2.json');
const shotsPath = abs('v3/shots.json');
for (const p of [screenplayPath, ledgerPath, shotsPath]) if (!fs.existsSync(p)) fail(`input ${rel(p)} does not exist`);

// ---------- shot of a frame ----------
const shotList = JSON.parse(fs.readFileSync(shotsPath, 'utf8')).shots;
const shotsOfFrame = (f) => shotList.filter((s) => f >= s.frames[0] && f < s.frames[1]).map((s) => s.id);

// ---------- write each story point's shot back, line by line, so the file keeps its format ----------
let text = fs.readFileSync(screenplayPath, 'utf8');
const sp0 = JSON.parse(text);
const unresolved = [];
for (const sp of sp0.story_points) {
  const hits = shotsOfFrame(sp.frame);
  const shot = hits.length === 1 ? hits[0] : null;
  if (!shot) unresolved.push(`${sp.id} (frame ${sp.frame}): ${hits.length ? `in ${hits.length} shots: ${hits.join(', ')}` : 'in no shot of v3/shots.json'}`);
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.includes(`{"id": "${sp.id}",`));
  if (at < 0) fail(`story point ${sp.id} is not on a line of its own in ${rel(screenplayPath)}`);
  const value = JSON.stringify(shot);
  if (/"shot": (null|"[^"]*"), /.test(lines[at])) lines[at] = lines[at].replace(/"shot": (null|"[^"]*"), /, `"shot": ${value}, `);
  else lines[at] = lines[at].replace(/("beat": "[^"]+", )/, `$1"shot": ${value}, `);
  text = lines.join('\n');
}
fs.writeFileSync(screenplayPath, text);
const sp = JSON.parse(text);
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const sourceHash = sha(fs.readFileSync(screenplayPath, 'utf8'), fs.readFileSync(ledgerPath, 'utf8'));

// ---------- the model both renders read ----------
const WORLD_NAMES = {home: 'HOME FIELD', crayon: 'CRAYON PAPER', line: 'LINE WORLD', shaded: 'SHADED GRID', portal: 'PORTAL'};
const locationOf = (world) => world.split('→').map((w) => WORLD_NAMES[w.trim()] ?? w.trim().toUpperCase()).join(' / ');
const pipelineId = (p) => `${p.shot ? p.shot.split('-')[0] : '?'}/${p.id}`;
const scenes = ledger.beats.map((b, i) => {
  const points = sp.story_points.filter((p) => p.beat === b.id);
  return {
    n: i + 1,
    beat: b.id,
    frames: b.frames,
    heading: `EXT. ${locationOf(b.world)} - ${b.id.toUpperCase().replace(/-/g, ' ')}`,
    points: points.map((p) => ({...p, pid: pipelineId(p), note: `${p.id} · f${p.frame} · ${p.colour} · ${p.register}`})),
  };
});
const themes = (sp.themes ?? []).map((t) => ({...t, carriedBy: sp.story_points.filter((p) => (p.themes ?? []).includes(t.id)).map((p) => p.id)}));
const asks = sp.asks.map((a) => `${a.id} (${a.story_point}): ${a.question}. Default: ${a.default}.`);
const stamp = (kind, body) => (kind === 'md' ? `<!-- generated from screenplay.json by scripts/animation/compile-screenplay.mjs · source ${sourceHash.slice(0, 12)} · body ${sha(body).slice(0, 12)} -->` : `/* generated from screenplay.json by scripts/animation/compile-screenplay.mjs · source ${sourceHash.slice(0, 12)} · body ${sha(body).slice(0, 12)} */`);

// ---------- fountain ----------
const fountainBody = (() => {
  const out = [`Title: ${sp.title}`, 'Credit: a silent film in eight beats', `Revision: ${sp.revision}`, 'Notes:', `    ${sp.logline}`, `    Thesis: ${sp.thesis}`, '', '===', ''];
  if (themes.length) {
    out.push('# themes', '');
    for (const t of themes) out.push(`= ${t.id} · ${t.name}: ${t.invariant} [[carried by ${t.carriedBy.join(', ')}]]`, '');
    out.push('===', '');
  }
  let lastShot;
  for (const s of scenes) {
    const shot = s.points[0]?.shot;
    if (shot && shot !== lastShot) out.push(`# ${shot}`, '');
    lastShot = shot ?? lastShot;
    out.push(`${s.heading} #${s.n}#`, '');
    for (const p of s.points) out.push(`${p.action} [[${p.note}]]`, '');
  }
  out.push(...asks.map((a) => `= ${a}`), '');
  return out.join('\n');
})();
fs.writeFileSync(fountainPath, `${stamp('fountain', fountainBody)}\n${fountainBody}`);

// ---------- markdown ----------
const runs = [];
for (const p of sp.story_points) {
  const last = runs[runs.length - 1];
  if (last && last.colour === p.colour) last.to = p;
  else runs.push({colour: p.colour, from: p, to: p});
}
const swatch = (key) => {
  const k = sp.colour_keys[key];
  return k ? (k.hue ? `${k.hue} / ${k.accent}` : `${k.kit} kit on ${k.field}`) : '?';
};
const mdBody = (() => {
  const out = [
    '> Generated from `v3/screenplay.json` by `npm run screenplay`. Edit the json, never this file.',
    '',
    `# ${sp.title}: screenplay`,
    '',
    `Revision ${sp.revision}`,
    '',
    `**Logline.** ${sp.logline}`,
    '',
    `**Thesis.** ${sp.thesis}`,
    '',
    '## Colour strip',
    '',
    runs.map((r) => `${r.colour} (${r.from.id}${r.from === r.to ? '' : `–${r.to.id}`})`).join(' → '),
    '',
    '| Key | Name | Hue / accent |',
    '| --- | --- | --- |',
    ...Object.entries(sp.colour_keys).map(([k, v]) => `| ${k} | ${v.name} | ${swatch(k)} |`),
    '',
  ];
  if (themes.length) {
    out.push('## Themes', '', 'What the film keeps true from beat to beat. A probe reads each one: `probe-screenplay.py` the tags and the channels, `probe-theme.py` the staging.', '');
    out.push('| Theme | What it says | Carried by | Measured by |', '| --- | --- | --- | --- |');
    for (const t of themes) out.push(`| ${t.id} · ${t.name} | ${t.invariant} (${t.source}) | ${t.carriedBy.join(', ')} | ${t.measure} |`);
    out.push('');
  }
  for (const s of scenes) {
    out.push(`## ${s.n}. ${s.heading} · frames ${s.frames[0]}–${s.frames[1]}`, '');
    for (const p of s.points) {
      out.push(`### ${p.pid} · ${p.slug} · f${p.frame} · ${p.colour} · ${p.register}`, '', p.action, '');
      const facts = [['wants', p.want], ['turn', p.turn], ['sees', p.sees], ['measure', p.measure], ['themes', (p.themes ?? []).join(', ')], ['channels', (p.channels ?? []).join(', ')], ['texture', (p.texture ?? []).join('; ')]].filter(([, v]) => v);
      out.push(...facts.map(([k, v]) => `- ${k}: ${v}`), '');
    }
  }
  out.push('## Asks', '', ...asks.map((a) => `- ${a}`), '');
  return out.join('\n');
})();
fs.writeFileSync(mdPath, `${stamp('md', mdBody)}\n${mdBody}`);

const withShot = sp.story_points.filter((p) => p.shot).length;
console.log(`screenplay: ${sp.story_points.length} story points in ${scenes.length} scenes, ${withShot} resolved to a shot, source ${sourceHash.slice(0, 12)} -> ${rel(mdPath)}, ${rel(fountainPath)}`);
if (unresolved.length) {
  console.error(`compile-screenplay: ${unresolved.length} story point(s) have no single shot:\n  ${unresolved.join('\n  ')}`);
  process.exit(1);
}
