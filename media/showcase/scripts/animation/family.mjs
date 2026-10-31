#!/usr/bin/env node
// Cuts a drawn plate into a plate family (D73, D85): its own mesh and its own skeleton registration. Run when `npm run plates` reports NEEDS FAMILY and an image generator
// has proposed the silhouette (scripts/s01_keys_request.py builds the request from the pose sheet; the generator draws a NEW silhouette family, never a key the rig can hold).
// usage: node scripts/animation/family.mjs <actor> <family> --plate <rgba.png> --shot <shot-id> --key <key-name> --silhouette <kind> [--grid 12]
//   1. the plate's alpha (>= 128) is the mask; maskToMesh triangulates it (the same mesher as assets/human/mesh.json);
//   2. the joints are registered by `fit-family.py`: the solved joints of --key fitted to the mask by scale and translation only, believed only when every group of bones is inside the mask
//      (0.90) and the skeleton explains the silhouette (0.80). A plate the solved skeleton does not agree with is REFUSED with the numbers, and nothing is written: a generator that
//      drew a lean where the guide said a curve gives a plate no fit can register, and a family registered by eye is the defect D85 removes;
//   3. on a pass, assets/<actor>/families/<family>/{plate.png, mesh.json, joints.json} are written with `registration: "fit"`, the fit numbers and `keySpace` (mesh px per key px and the
//      translation), which `plates-from-poses.mjs` applies to every key it draws from this family. A skeleton toolchain (v3/studies/tech-rig-01.md) would write
//      `registration: "toolchain"` instead; it is not installed in this environment.
// exit 0 family written, 1 plate refused by the fit, 2 input error
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {loadTs, root} from './load-ts.mjs';
import {readGrayPng} from '../lib/png-gray.mjs';
import {sha256} from '../lib/families.mjs';

const [actor, family] = process.argv.slice(2, 4);
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
const plate = arg('plate'), shot = arg('shot'), keyName = arg('key'), silhouette = arg('silhouette'), grid = Number(arg('grid') ?? 12);
if (!actor || !family || !plate || !shot || !keyName || !silhouette) {
  console.error('usage: family.mjs <actor> <family> --plate <rgba.png> --shot <shot-id> --key <key-name> --silhouette <kind> [--grid 12]');
  process.exit(2);
}
const poses = JSON.parse(fs.readFileSync(path.join(root, 'v3/poses', `${shot}.json`), 'utf8'));
const key = poses.keys.find((k) => k.name === keyName);
if (!key?.solved) { console.error(`input error: ${shot} has no solved key "${keyName}"`); process.exit(2); }
const work = path.join(root, 'out', `${shot}-families`);
fs.mkdirSync(work, {recursive: true});
const jointsPath = path.join(work, `${family}-joints.json`), maskPath = path.join(work, `${family}-mask.png`), fitPath = path.join(work, `${family}-fit.json`);
fs.writeFileSync(jointsPath, JSON.stringify(key.solved));
const fit = spawnSync('python3', [path.join(root, 'scripts/animation/fit-family.py'), path.resolve(root, plate), jointsPath, maskPath, fitPath], {cwd: root, encoding: 'utf8'});
const lines = fit.stdout.trim().split('\n');
if (fit.status === 2 || !fs.existsSync(fitPath)) { console.error(fit.stdout, fit.stderr); process.exit(2); }
const result = JSON.parse(fs.readFileSync(fitPath, 'utf8'));
const summary = `${family}: plate ${plate} (${silhouette}), solved joints of ${keyName}: scale ${result.scale}, translate ${result.translate}, coverage ${JSON.stringify(result.coverage)}, explained ${result.explained}`;
if (!result.pass) {
  console.log(`REFUSED ${summary}: the plate does not agree with the skeleton it was asked to draw; no family written`);
  console.log(lines[0]);
  process.exit(1);
}
const {maskToMesh} = await loadTs('src/library/motion/mesh.ts');
const mask = readGrayPng(maskPath);
const mesh = maskToMesh(mask, {region: [0, 0, mask.width, mask.height], simplify: 1.0, gridSpacing: grid});
const dir = path.join(root, 'assets', actor, 'families', family);
fs.mkdirSync(dir, {recursive: true});
fs.copyFileSync(path.resolve(root, plate), path.join(dir, 'plate.png'));
const round = (a, d) => Array.from(a, (v) => Math.round(v * d) / d);
fs.writeFileSync(path.join(dir, 'mesh.json'), JSON.stringify({width: mask.width, height: mask.height, region: [0, 0, mask.width, mask.height], simplify: 1.0, gridSpacing: grid, vertices: round(mesh.vertices, 1000), triangles: Array.from(mesh.triangles), uvs: round(mesh.uvs, 1e6)}) + '\n');
const {scale, translate} = result;
const joints = Object.fromEntries(Object.entries(key.solved).map(([n, p]) => [n, [Math.round((p[0] * scale + translate[0]) * 100) / 100, Math.round((p[1] * scale + translate[1]) * 100) / 100]]));
const home = JSON.parse(fs.readFileSync(path.join(root, 'assets', actor, 'families/home/joints.json'), 'utf8'));
fs.writeFileSync(path.join(dir, 'joints.json'), JSON.stringify({
  family, actor, silhouette, registration: 'fit',
  method: `The solved joints of ${shot}/${keyName} (${key.solvedAt}) fitted to the plate's mask by scale and translation only (scripts/animation/fit-family.py); every bone group inside the mask and the skeleton explaining the silhouette. Not a toolchain registration and not placed by eye.`,
  fit: {...result, key: `${shot}:${keyName}`}, keySpace: {scale, translate}, space: 'mesh', restHeightPx: Math.round(home.restHeightPx * scale),
  plateSha256: sha256(path.join(dir, 'plate.png')), meshSha256: sha256(path.join(dir, 'mesh.json')), joints, parents: home.parents,
}, null, 1) + '\n');
console.log(`REGISTERED (fit) ${summary}; ${mesh.stats.vertices} vertices, ${mesh.stats.triangles} triangles -> ${path.relative(root, dir)}`);
