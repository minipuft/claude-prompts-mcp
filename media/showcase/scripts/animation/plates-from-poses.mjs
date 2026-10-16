#!/usr/bin/env node
// Builds a shot's key plates in the project, from the pose sheet's solved joints through the plate family's mesh (D85), and registers them.
// usage: node scripts/animation/plates-from-poses.mjs <shot-id>     (npm run plates -- <shot-id>)     exit 0 every key has a plate and passes measure-keys.py, 1 a key needs a family or a plate is rejected, 2 input error
//
// For every key of v3/poses/<shot>.json:
//   1. the key's `solved` joints (npm run solve-poses) are the key's joints: they are written to v3/keys/<shot>.json as the registered joints with `source: "solver"`;
//   2. the families that may draw it are tried in order: the family directory named by the key's `plateFamily` (assets/<actor>/families/<plateFamily>), then `home` (the model-sheet
//      plate). A family with parts (npm run parts, assets/<actor>/families/<family>/parts) is a parts rig: every part is its own ARAP mesh pinned at its bone's joints by
//      src/library/motion/partsRig.ts (the code the film's MeshFigure runs), and the parts are drawn in the key's order, `defaultOrder` of the solved joints (the lead arm and leg and a
//      limb that crosses the spine in front; the poncho behind the torso, the hair behind the head) under the pose sheet key's own `order`. A family without parts is one ARAP mesh.
//      The first family that holds the pose (render-plates.py, plate_tools.HOLD_LIMITS: not turned inside out, not strained, no part drawn over another; for a parts rig each part's own
//      mesh is measured) is rendered to assets/<actor>/keys/<shot>/K<n>.png at the model sheet's scale on its baseline, role colours, soft alpha (D71), contour kept from the family plate
//      (D76), and K<n>-crop.png over a pure black field; a parts rig's plate also reports the hinge measure at every shoulder, elbow and knee (parts_tools.joint_fill);
//   3. a key no family holds is reported NEEDS FAMILY with its silhouette kind and gets no plate: the key sheet says `status: "needs-family"` and `probe-poses.py --joints keys`
//      refuses it by name. An image generator is asked only for that new silhouette family, which is cut into its own mesh (family.mjs) and registered, never placed by eye.
// Then `measure-keys.py` measures every plate on what the prompts contract (C20, C21, C22, C31) into the key sheet's `measured` and out/<shot>-keys-table.txt.
// The key space is the home family's mask space: the pose sheet's `heightPx` must equal the home family's `restHeightPx` (922), so a solved joint IS a mesh position.
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {loadTs, root} from './load-ts.mjs';
import {listFamilies, loadFamily} from '../lib/families.mjs';
import {loadParts} from '../lib/parts.mjs';

const shot = process.argv[2];
if (!shot || shot.startsWith('--')) {
  console.error('usage: plates-from-poses.mjs <shot-id>');
  process.exit(2);
}
const rel = (p) => path.relative(root, p);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const posesPath = path.join(root, 'v3/poses', `${shot}.json`), keysPath = path.join(root, 'v3/keys', `${shot}.json`);
for (const p of [posesPath, keysPath]) if (!fs.existsSync(p)) { console.error(`input error: ${rel(p)} does not exist`); process.exit(2); }

const {parsePoseSheet} = await loadTs('src/library/animation/pose.ts');
const {Arap} = await loadTs('src/library/motion/arap.ts');
const {parseParts, PartsRig, defaultOrder, applyOrder, frontOf, limbDepths} = await loadTs('src/library/motion/partsRig.ts');
const posesRaw = readJson(posesPath), sheet = parsePoseSheet(structuredClone(posesRaw)), old = readJson(keysPath);
const actor = sheet.actor;
const unsolved = posesRaw.keys.filter((k) => !k.solved).map((k) => k.name);
if (unsolved.length) { console.error(`input error: no solved joints on ${unsolved.join(', ')}; run \`npm run solve-poses -- ${shot}\` first`); process.exit(2); }

const families = Object.fromEntries(listFamilies(root, actor).map((id) => [id, loadFamily(root, actor, id)]));
const home = families.home;
if (!home) { console.error(`input error: assets/${actor}/families/home does not exist`); process.exit(2); }
if (sheet.heightPx !== home.meta.restHeightPx) {
  console.error(`input error: the pose sheet's heightPx is ${sheet.heightPx}, the home family's rest figure is ${home.meta.restHeightPx}: the key space is the home mask space, so the solved joints are mesh positions only when they agree (set heightPx, run solve-poses)`);
  process.exit(2);
}

// ARAP per family: pins are the family's own joints, in its mesh space; a key's solved joints go through the family's keySpace (mesh px per key px, then a translation)
const keySpaceOf = (f) => f.meta.keySpace ?? {scale: 1, translate: [0, 0]};
const solvers = new Map();
const solverOf = (f) => {
  if (!solvers.has(f.id)) {
    const names = Object.keys(f.restPose);
    solvers.set(f.id, {names, arap: new Arap({vertices: f.mesh.vertices, triangles: f.mesh.triangles}, Float32Array.from(names.flatMap((n) => f.restPose[n])))});
  }
  return solvers.get(f.id);
};
const pose = (f, solved) => {
  const {names, arap} = solverOf(f), ks = keySpaceOf(f);
  const pins = names.flatMap((n) => (solved[n] ? [solved[n][0] * ks.scale + ks.translate[0], solved[n][1] * ks.scale + ks.translate[1]] : f.restPose[n]));
  return Array.from(arap.solve(Float32Array.from(pins)), (v) => Math.round(v * 1000) / 1000);
};

// the parts rig of a family that has parts: one ARAP solver per part, built once
const rigs = new Map();
const rigOf = (f) => {
  if (!rigs.has(f.id)) {
    const has = fs.existsSync(path.join(f.dir, 'parts', 'parts.json'));
    const file = has ? parseParts(loadParts(root, actor, f.id).file, f.restPose) : null;
    rigs.set(f.id, file && {file, rig: new PartsRig(file, f.restPose)});
  }
  return rigs.get(f.id);
};
const inFamilySpace = (f, solved) => { const ks = keySpaceOf(f); return Object.fromEntries(Object.entries(solved).map(([n, p]) => [n, [p[0] * ks.scale + ks.translate[0], p[1] * ks.scale + ks.translate[1]]])); };
const round3 = (a) => Array.from(a, (v) => Math.round(v * 1000) / 1000);
const candidateOf = (f, key, solved) => {
  const pr = rigOf(f);
  if (!pr) return {family: f.id, keySpace: keySpaceOf(f), posed: pose(f, solved)};
  const now = inFamilySpace(f, solved);
  const order = applyOrder(defaultOrder(pr.file, now, key.lead, key.weight.foot), key.order);
  const posed = pr.rig.pose(now);
  return {family: f.id, keySpace: keySpaceOf(f), rig: 'parts', order, front: Object.fromEntries(pr.file.parts.map((p) => [p.name, Array.from(frontOf(pr.file, order, p.name))])),
          posed: Object.fromEntries(Object.entries(posed).map(([n, v]) => [n, round3(v)])), joints: now};
};

const outDir = path.join(root, 'assets', actor, 'keys', shot);
fs.mkdirSync(outDir, {recursive: true});
const work = path.join(root, 'out', `${shot}-plates`);
fs.mkdirSync(work, {recursive: true});
const items = sheet.keys.map((key, i) => {
  const solved = posesRaw.keys[i].solved;
  const ids = [...new Set([key.plateFamily, 'home'].filter((id) => id && families[id]))];
  return {key: key.name, number: i + 1, candidates: ids.map((id) => candidateOf(families[id], key, solved))};
});
const jobPath = path.join(work, 'job.json'), resultPath = path.join(work, 'result.json');
fs.writeFileSync(jobPath, JSON.stringify({shot, actor, outDir, items}));
// a plate this run does not draw is not left behind from an earlier one: only the plates the key sheet names stand in the directory (generator plates of earlier runs are kept under assets/<actor>/keys/<shot>-run<N>/)
for (const f of fs.readdirSync(outDir)) if (/^K\d+(-crop)?\.png$/.test(f)) fs.rmSync(path.join(outDir, f));
const run = spawnSync('python3', [path.join(root, 'scripts/animation/render-plates.py'), jobPath, resultPath], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
process.stdout.write(run.stdout);
if (run.status !== 0) process.exit(run.status === 2 ? 2 : 1);
const result = readJson(resultPath);

// the key sheet: the solved joints are the registered joints; the plate, its hash and what the raster measured go beside them
const round2 = (v) => Math.round(v * 100) / 100;
const keys = sheet.keys.map((spec, i) => {
  const got = result.items[spec.name], c = got.chosen, solvedAt = posesRaw.keys[i].solvedAt;
  const base = {name: spec.name, frame: spec.frame, hold: spec.hold, joints: Object.fromEntries(Object.entries(posesRaw.keys[i].solved).map(([n, p]) => [n, [round2(p[0]), round2(p[1])]])), source: 'solver', solvedAt, plateFamily: spec.plateFamily};
  if (!c) return {...base, status: 'needs-family', plate: null, needsFamily: {family: spec.plateFamily, silhouette: spec.silhouette, tried: got.tried}};
  return {...base, status: 'plate', family: c.family, registration: c.registration, plate: c.plate, plateSha256: c.plateSha256, plateInfo: c.info,
    render: {hold: c.metrics, partScales: c.partScales, ...(c.rig ? {rig: c.rig, order: c.order, depths: limbDepths(posesRaw.keys[i].solved, spec.lead, spec.weight.foot), declaredOrder: spec.order ?? null, parts: c.parts, worstParts: c.worstParts, jointFill: c.jointFill} : {})}};
});
const sheetOut = {
  shot, actor, provisional: true,
  note: `Key plates built in the project (D85): each key's joints are the pose sheet's solved joints (\`source: "solver"\`, npm run solve-poses) and its plate is the plate family's mesh (a parts rig: every part its own ARAP mesh, drawn in the key's order) posed to those joints and rendered at the model sheet's scale on its baseline (scripts/animation/plates-from-poses.mjs). A key no family mesh holds is \`needs-family\` and has no plate. \`measured\` is scripts/animation/measure-keys.py. Frames are shot-local = film frames. Holds and breakdowns are the chart's.`,
  keys, breakdowns: old.breakdowns,
};
fs.writeFileSync(keysPath, JSON.stringify(sheetOut, null, 1) + '\n');
// the plates the compositions load by staticFile: public/ mirrors assets/<actor>/keys/<shot>
const mirror = path.join(root, 'public/assets', actor, 'keys', shot);
fs.rmSync(mirror, {recursive: true, force: true});
fs.mkdirSync(mirror, {recursive: true});
for (const k of keys.filter((k) => k.status === 'plate')) fs.copyFileSync(path.join(root, k.plate), path.join(mirror, path.basename(k.plate)));
// the plate geometry the pose sheet composition reads
const plates = keys.map((k, i) => ({key: `K${i + 1}`, name: k.name, plate: k.plate, family: k.family ?? null, cropPx: k.plateInfo?.cropPx ?? [0, 0], baselineInCrop: k.plateInfo?.baselineInCrop ?? 0, scale: k.plateInfo?.scale ?? 0, originMask: k.plateInfo?.originMask ?? [0, 0]}));
fs.writeFileSync(path.join(outDir, 'plates.json'), JSON.stringify(plates, null, 1) + '\n');
console.log(`wrote ${rel(keysPath)} (${keys.filter((k) => k.status === 'plate').length} plates, ${keys.filter((k) => k.status !== 'plate').length} needing a family) and ${rel(path.join(outDir, 'plates.json'))}`);

// the film rig's picture of every key (src/scenes/KeyFilmS01.tsx, the component the film draws the human with): measure-keys.py compares it to the plates
const film = spawnSync('npx', ['remotion', 'render', 'src/index.ts', 'KeyFilmS01', path.join('out', `${shot}-key-film`), '--sequence', '--image-format=png', '--concurrency=4'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe']});
if (film.status !== 0) { console.error(film.stderr.split('\n').slice(-12).join('\n')); console.error('input error: the film rig could not render the keys'); process.exit(2); }
const measure = spawnSync('python3', [path.join(root, 'scripts/animation/measure-keys.py'), shot], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
process.stdout.write(measure.stdout);
if (measure.status === 2 || measure.status === null) process.exit(2);
for (const k of keys.filter((k) => k.status !== 'plate')) console.log(`NEEDS FAMILY: ${k.name} (${k.needsFamily.family}, silhouette ${k.needsFamily.silhouette})`);
// a green `plates` over a red table is a lie: every key has a plate AND every plate passes what measure-keys.py measures (C20, C21, C22, C31, the hinge measure, the film)
process.exit(keys.every((k) => k.status === 'plate') && measure.status === 0 ? 0 : 1);
