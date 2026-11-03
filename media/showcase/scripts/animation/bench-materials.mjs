#!/usr/bin/env node
// The materials bench (D97, row 8.4): every material with motion is solved into a Verlet chain (src/library/animation/secondaries.ts), the chain's anchor is driven through three canonical
// primaries and the tip is measured against what the material declares.
//   step     120 px over 1 frame, then held 60 frames        impulse  60 px out and back over 6 frames, then held 60        sine  40 px amplitude, 12-frame period, 48 frames, then held 60
// Measured on the tip (x displacement): lag = the shift at which tip and anchor correlate best (velocities for the step, displacements for the others); settle = frames from the primary's stop to
// the last frame the tip moves faster than 0.5 % of 720 px per frame; overshoot = the first return past rest over the move (step and impulse); ease class = snap, even or float from the spacing
// profile of the tip's slow-out. Held to the declaration: lag at least the declared on the step and the impulse (and on the sine when the declared lag is under its half period, 6 frames),
// settle within 2 frames and overshoot within 0.08 on the step. The impulse and sine settle, overshoot and ease are reported, not held: the declaration is a statement about the step.
// Control first: a material declaring a lag of 6 against a chain solved for 2, and cloth declaring drag 1.0 (all its damping spent on the air) on the chain the closed form alone gives (the
// designed chain absorbs a drag of 1.0 by raising its frequency, so the control runs the solver the bench has to catch), must each be refused by this bench's own check
// (exit 1 on a refusal of the real materials; exit 2 when a control does not trip).
// usage: node scripts/animation/bench-materials.mjs [--materials v3/materials.json] [--json v3/materials-bench.json] [--html out/materials-bench.html] [--segment 240]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {loadTs, root} from './load-ts.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const abs = (p) => path.resolve(root, p);
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
const materialsPath = abs(arg('materials', 'v3/materials.json'));
const jsonPath = abs(arg('json', 'v3/materials-bench.json'));
const htmlPath = abs(arg('html', 'out/materials-bench.html'));
const SEGMENT = Number(arg('segment', 240));
if (!Number.isFinite(SEGMENT) || SEGMENT < 1) {
  console.error(`bench-materials: --segment ${arg('segment')} is not a length in px`);
  process.exit(2);
}
const BONE = {segment: SEGMENT};

const sec = await loadTs('src/library/animation/secondaries.ts');
const mat = await loadTs('src/library/animation/materials.ts');
const {PRIMARIES, TOLERANCE, SINE_HALF_PERIOD, designChain, benchResponses} = sec;

// ---------- the check: the declaration against the measurement ----------
const round = (v, d = 3) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);
/** [{name, ok, text}] for one declared motion and its three responses (step, impulse, sine). */
const judge = (declared, responses, design) => {
  const [step, impulse, sine] = responses;
  const lags = [['step', step.lag], ['impulse', impulse.lag], ...(declared.lagFrames < SINE_HALF_PERIOD ? [['sine', sine.lag]] : [])];
  const short = lags.filter(([, lag]) => lag < declared.lagFrames);
  const shown = `${step.lag} / ${impulse.lag} / ${sine.lag} (step / impulse / sine)`;
  return [
    {name: 'lag', ok: short.length === 0, text: short.length ? `${short.map(([n, l]) => `${n} trails ${l}`).join(', ')}, under the declared ${declared.lagFrames}` : `trails ${shown}, at least the declared ${declared.lagFrames}${declared.lagFrames >= SINE_HALF_PERIOD ? ' (the sine is not held: a 12-frame period cannot show a lag of 6 or more)' : ''}`},
    {name: 'settle', ok: Math.abs(step.settle - declared.settleFrames) <= TOLERANCE.settle, text: `step settles ${step.settle} frames after the stop, declared ${declared.settleFrames} (±${TOLERANCE.settle})`},
    {name: 'overshoot', ok: Math.abs((step.overshoot ?? 0) - declared.overshoot) <= TOLERANCE.overshoot, text: `step overshoots ${round(step.overshoot)}, declared ${declared.overshoot} (±${TOLERANCE.overshoot})`},
    {name: 'design', ok: design.met, text: design.met ? `${design.points} point${design.points > 1 ? 's' : ''}, ω ${round(design.frequency)} rad/frame, damping ${round(design.air + design.internal)} per frame (air ${design.air})` : `no chain of up to ${sec.MAX_POINTS} points met the declaration; closest ${design.points} point${design.points > 1 ? 's' : ''}`},
  ];
};

// ---------- control ----------
// the planted motions are literals, so the control does not move with the file under test
const PLANT_LINE = {mass: 0, lagFrames: 2, settleFrames: 6, overshoot: 0, drag: 0.2, stiffness: 0.8, contact: null};
const PLANT_CLOTH = {mass: 1, lagFrames: 6, settleFrames: 14, overshoot: 0.18, drag: 0.12, stiffness: 0.1, contact: 6};
const control = () => {
  const lineMotion = PLANT_LINE;
  const solvedForTwo = designChain(lineMotion, BONE);
  const lagSix = judge({...lineMotion, lagFrames: 6}, benchResponses(solvedForTwo, BONE), solvedForTwo);
  const dragOne = {...PLANT_CLOTH, drag: 1};
  const unfitted = sec.seedChain(dragOne);
  const dragChecks = judge(dragOne, benchResponses(unfitted, BONE), {...unfitted, met: false, seed: sec.secondOrderOf(dragOne.settleFrames, dragOne.overshoot)});
  const refusedBy = (checks) => checks.filter((c) => !c.ok).map((c) => c.name);
  const planted = [
    {name: 'a declared lag of 6 against a chain solved for 2', checks: lagSix, wants: 'lag'},
    {name: 'cloth declaring drag 1.0 on the unfitted closed-form chain', checks: dragChecks, wants: null},
  ];
  const lines = planted.map((p) => `${p.name} -> ${refusedBy(p.checks).length ? `refused on ${refusedBy(p.checks).join(', ')} (${p.checks.filter((c) => !c.ok).map((c) => c.text).join('; ')})` : 'NOT REFUSED'}`);
  console.log(`control: ${lines.join('; ')}`);
  const stuck = planted.filter((p) => (p.wants ? !refusedBy(p.checks).includes(p.wants) : refusedBy(p.checks).length === 0));
  if (stuck.length) {
    console.log(`refused: the bench did not refuse ${stuck.map((p) => p.name).join(', ')}, so a pass from it would mean nothing`);
    process.exit(2);
  }
};
control();

// ---------- the bench ----------
const bytes = fs.readFileSync(materialsPath);
const materials = JSON.parse(bytes.toString('utf8'));
const results = [];
const skipped = [];
for (const id of Object.keys(materials)) {
  const m = materials[id];
  const declared = mat.motionOf(m);
  if (!declared) {
    skipped.push(id);
    continue;
  }
  const design = designChain(declared, BONE);
  const responses = benchResponses(design, BONE);
  const checks = judge(declared, responses, design);
  results.push({
    material: id,
    declared,
    intents: Object.fromEntries(['mass', 'lagFrames', 'settleFrames', 'overshoot', 'drag', 'stiffness'].map((f) => [f, m[f]?.intent ?? null])),
    design: {points: design.points, frequency: round(design.frequency, 4), air: design.air, internal: round(design.internal, 4), gravity: round(design.gravity, 4), seed: {damping: round(design.seed.damping, 4), frequency: round(design.seed.frequency, 4)}, met: design.met},
    measured: Object.fromEntries(responses.map((r) => [r.primary, {lag: r.lag, settle: r.settle, overshoot: round(r.overshoot), ease: r.ease, sagPx: round(Math.max(...r.tipY.map(Math.abs)), 1)}])),
    curves: Object.fromEntries(responses.map((r) => [r.primary, {anchor: r.anchor.map((v) => round(v, 1)), tip: r.tip.map((v) => round(v, 1))}])),
    checks,
    pass: checks.every((c) => c.ok),
  });
}
const failed = results.filter((r) => !r.pass);

for (const r of results) {
  const s = r.measured.step, i = r.measured.impulse, n = r.measured.sine;
  console.log(`  ${r.pass ? 'ok  ' : 'FAIL'} ${r.material}: lag ${s.lag}/${i.lag}/${n.lag} against ${r.declared.lagFrames}; settle ${s.settle} against ${r.declared.settleFrames}; overshoot ${s.overshoot} against ${r.declared.overshoot}; ease ${s.ease}${r.pass ? '' : ' -- ' + r.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.text}`).join('; ')}`);
}
if (skipped.length) console.log(`  not benched (declare no lag or settle): ${skipped.join(', ')}`);

const out = {
  schema: 'showcase.materials-bench.1',
  materialsHash: crypto.createHash('sha256').update(bytes).digest('hex'),
  bone: {segmentPx: SEGMENT, direction: [0, 1]},
  primaries: PRIMARIES.map((p) => ({name: p.name, stopFrame: p.stop, amplitudePx: p.amplitude, frames: p.anchor.length})),
  tolerance: {...TOLERANCE, lag: 'at least the declared on the step and the impulse (and the sine when the declared lag is under 6)'},
  restSpeedPx: sec.REST_SPEED,
  results,
  skipped,
};
fs.mkdirSync(path.dirname(jsonPath), {recursive: true});
fs.writeFileSync(jsonPath, JSON.stringify(out) + '\n');

// ---------- the page ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const W = 300, H = 120, PAD = 6;
const strip = (curve, primary, measured) => {
  const n = curve.anchor.length, ys = [...curve.anchor, ...curve.tip], lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), span = hi - lo || 1;
  const x = (f) => PAD + (f * (W - 2 * PAD)) / (n - 1), y = (v) => H - PAD - ((v - lo) * (H - 2 * PAD)) / span;
  const pts = (xs) => xs.map((v, f) => `${x(f).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const stop = primary.stopFrame, settleAt = Math.min(n - 1, stop + measured.settle);
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(primary.name)}: anchor and tip x displacement">
<line x1="${PAD}" x2="${W - PAD}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="#333"/>
<line x1="${x(stop).toFixed(1)}" x2="${x(stop).toFixed(1)}" y1="${PAD}" y2="${H - PAD}" stroke="#666" stroke-dasharray="3 3"/>
<line x1="${x(settleAt).toFixed(1)}" x2="${x(settleAt).toFixed(1)}" y1="${PAD}" y2="${H - PAD}" stroke="#f0b35a" stroke-dasharray="2 3" opacity=".7"/>
<polyline points="${pts(curve.anchor)}" fill="none" stroke="#8fb7ff" stroke-width="1.4" opacity=".8"/>
<polyline points="${pts(curve.tip)}" fill="none" stroke="#f0b35a" stroke-width="1.8"/></svg>`;
};
const intent = (w) => (w ? ` <i>${esc(w)}</i>` : '');
const card = (r) => {
  const rows = [
    ['lag (frames)', `at least ${r.declared.lagFrames}${intent(r.intents.lagFrames)}`, `${r.measured.step.lag} · ${r.measured.impulse.lag} · ${r.measured.sine.lag}`, r.checks[0].ok],
    ['settle (frames)', `${r.declared.settleFrames} ± ${TOLERANCE.settle}${intent(r.intents.settleFrames)}`, `${r.measured.step.settle} · ${r.measured.impulse.settle} · ${r.measured.sine.settle}`, r.checks[1].ok],
    ['overshoot', `${r.declared.overshoot} ± ${TOLERANCE.overshoot}${intent(r.intents.overshoot)}`, `${r.measured.step.overshoot} · ${r.measured.impulse.overshoot} · –`, r.checks[2].ok],
    ['ease class', `drag ${r.declared.drag}${intent(r.intents.drag)}`, `${r.measured.step.ease} · ${r.measured.impulse.ease} · ${r.measured.sine.ease}`, null],
    ['mass · stiffness', `${r.declared.mass}${intent(r.intents.mass)} · ${r.declared.stiffness}${intent(r.intents.stiffness)}`, `sag ${r.measured.step.sagPx} px under the step`, null],
  ];
  return `<section class="card ${r.pass ? 'pass' : 'fail'}"><h2>${esc(r.material)} <small>${r.pass ? 'meets its declaration' : 'refused'}</small></h2>
<div class="strips">${PRIMARIES.map((p) => `<figure>${strip(r.curves[p.name], out.primaries.find((x) => x.name === p.name), r.measured[p.name])}<figcaption>${esc(p.name)} · lag ${r.measured[p.name].lag}${p.name === 'sine' ? '' : ` · settle ${r.measured[p.name].settle}`}</figcaption></figure>`).join('')}</div>
<table><thead><tr><th></th><th>declared</th><th>measured (step · impulse · sine)</th><th></th></tr></thead><tbody>${rows.map(([k, d, m, ok]) => `<tr><th>${k}</th><td>${d}</td><td>${m}</td><td class="${ok === null ? '' : ok ? 'y' : 'n'}">${ok === null ? '' : ok ? 'ok' : 'refused'}</td></tr>`).join('')}</tbody></table>
<p class="d">${esc(r.checks[3].text)}${r.design.met ? '' : ' (not met)'}; closed-form seed ζ ${r.design.seed.damping}, ω ${r.design.seed.frequency}.</p></section>`;
};
const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Materials bench</title>
<style>
body{background:#111;color:#eee;font:14px/1.45 system-ui,sans-serif;margin:0;padding:22px 32px 40px}h1{font-weight:500;margin:0 0 2px}.sub{color:#999;margin-bottom:16px;max-width:110ch}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(1000px,1fr));gap:14px}
.card{background:#181818;border-radius:8px;padding:10px 16px;border-left:6px solid #6fbf73}.card.fail{border-color:#f58a7a}
h2{margin:0 0 6px;font-size:17px;font-weight:600}h2 small{color:#999;font-weight:400;font-size:12px;margin-left:8px}
.strips{display:flex;gap:14px;flex-wrap:wrap}figure{margin:0}figure svg{background:#141414;border-radius:4px;display:block}figcaption{color:#999;font-size:12px}
table{border-collapse:collapse;margin-top:8px;font-size:13px;font-variant-numeric:tabular-nums}th,td{border-bottom:1px solid #2a2a2a;padding:3px 12px 3px 0;text-align:left}thead th{color:#999;font-weight:500}tbody th{color:#aaa;font-weight:500}
td.y{color:#6fbf73}td.n{color:#f58a7a}i{color:#8fb7ff;font-style:normal;font-size:11px;margin-left:4px}.d{color:#888;font-size:12px;margin:6px 0 0}
.key span{display:inline-block;width:18px;height:3px;vertical-align:middle;margin:0 4px 0 12px}
</style>
<h1>Materials bench</h1>
<div class="sub">Each material is solved into a Verlet chain on a ${SEGMENT} px bone hung from the anchor and driven through three primaries; the tip is measured against the declaration in <code>v3/materials.json</code>
(${esc(out.materialsHash.slice(0, 12))}). Lag is held on the step and the impulse (and on the sine when the declared lag is under 6); settle and overshoot are held on the step; the rest is reported.
<span class="key"><span style="background:#8fb7ff"></span>anchor<span style="background:#f0b35a"></span>tip<span style="background:#666"></span>primary stops<span style="background:#f0b35a;opacity:.6"></span>tip at rest</span>
${skipped.length ? `<br>Not benched, no lag or settle declared: ${esc(skipped.join(', '))}.` : ''}</div>
<div class="grid">${results.map(card).join('\n')}</div></html>
`;
fs.mkdirSync(path.dirname(htmlPath), {recursive: true});
fs.writeFileSync(htmlPath, html);

if (failed.length) {
  console.log(`refused: ${failed.map((r) => `${r.material}: ${r.checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.text})`).join(', ')}`).join('; ')}`);
  process.exit(1);
}
console.log(`pass: bench - ${results.length} materials with motion meet their declared lag, settle and overshoot on a ${SEGMENT} px bone (${skipped.length} not benched) -> ${rel(jsonPath)}, ${rel(htmlPath)}`);
