#!/usr/bin/env node
/**
 * Measures the mesh rig (D73): rest-pose IoU against mask.png, rest joint error, ARAP solve time, and writes the pin sets and our solutions
 * for the Python reference comparison (scripts/arap-ref-compare.py).
 *
 * usage: node scripts/measure-mesh.mjs [--mesh assets/human/mesh.json] [--out /tmp/arap-pinsets.json]
 * The poses come from src/library/cast/humanPose.ts, bundled with esbuild (a transitive dependency of @remotion/bundler) because Node
 * cannot resolve that file's extensionless imports; arap.ts and mesh.ts load directly (Node strips their types).
 */
import {readFileSync, writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {readGrayPng} from './lib/png-gray.mjs';
import {Arap} from '../src/library/motion/arap.ts';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const meshPath = args.mesh ?? 'assets/human/mesh.json';
const outPath = args.out ?? '/tmp/arap-pinsets.json';

const dir = mkdtempSync(join(tmpdir(), 'measure-mesh-'));
await build({entryPoints: ['src/library/cast/humanPose.ts', 'src/library/motion.ts'], outdir: dir, bundle: true, format: 'esm', outExtension: {'.js': '.mjs'}, loader: {'.json': 'json'}, logLevel: 'error'});
const {jointNames, restPose, liftChart, jointParents} = await import(pathToFileURL(join(dir, 'cast/humanPose.mjs')).href);
const {poseAt} = await import(pathToFileURL(join(dir, 'motion.mjs')).href);

const meshJson = JSON.parse(readFileSync(meshPath, 'utf8'));
const mesh = {vertices: Float32Array.from(meshJson.vertices), triangles: Uint32Array.from(meshJson.triangles)};
const V = mesh.vertices.length / 2;
const pinsOf = (joints) => Float32Array.from(jointNames.flatMap((n) => joints[n]));

const t0 = performance.now();
const arap = new Arap(mesh, pinsOf(restPose));
const constructMs = performance.now() - t0;

// rasterise triangles at pixel centres; coverage = union
const raster = (vertices, w, h) => {
  const cov = new Uint8Array(w * h);
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const i = [0, 1, 2].map((k) => mesh.triangles[t + k]);
    const [ax, ay, bx, by, cx, cy] = i.flatMap((v) => [vertices[2 * v], vertices[2 * v + 1]]);
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area === 0) continue;
    const sgn = Math.sign(area);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const e1 = sgn * ((bx - ax) * (py - ay) - (by - ay) * (px - ax));
      const e2 = sgn * ((cx - bx) * (py - by) - (cy - by) * (px - bx));
      const e3 = sgn * ((ax - cx) * (py - cy) - (ay - cy) * (px - cx));
      if (e1 >= 0 && e2 >= 0 && e3 >= 0) cov[y * w + x] = 1;
    }
  }
  return cov;
};
const mask = readGrayPng('assets/human/mask.png');
const [rx0, ry0, rx1, ry1] = meshJson.region;
const truth = new Uint8Array(mask.width * mask.height);
for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) if (mask.data[y * mask.width + x] >= 128) truth[y * mask.width + x] = 1;
const iou = (cov) => { let i = 0, u = 0; for (let k = 0; k < cov.length; k++) { i += cov[k] & truth[k]; u += cov[k] | truth[k]; } return i / u; };

const restSolved = arap.solve(pinsOf(restPose));
const restIoUSolved = iou(raster(restSolved, mask.width, mask.height));
const restIoUMesh = iou(raster(mesh.vertices, mask.width, mask.height));
const pinAt = arap.pinPositions(restSolved), pinWant = pinsOf(restPose);
let maxJoint = 0, maxVertex = 0;
for (let k = 0; k < pinWant.length / 2; k++) maxJoint = Math.max(maxJoint, Math.hypot(pinAt[2 * k] - pinWant[2 * k], pinAt[2 * k + 1] - pinWant[2 * k + 1]));
for (let v = 0; v < V; v++) maxVertex = Math.max(maxVertex, Math.hypot(restSolved[2 * v] - mesh.vertices[2 * v], restSolved[2 * v + 1] - mesh.vertices[2 * v + 1]));

// solve time over every pose of the 90-frame lift (each frame's pose, 5 passes)
const times = [];
for (let pass = 0; pass < 5; pass++) for (let f = 0; f < 90; f++) {
  const pins = pinsOf(poseAt(liftChart, f, jointParents));
  const a = performance.now();
  arap.solve(pins);
  times.push(performance.now() - a);
}
times.sort((p, q) => p - q);
const q = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];

// the pin sets compared against the Python reference: the three keys of the chart
const sets = liftChart.keys.map((k) => ({frame: k.frame, pins: Array.from(pinsOf(k.joints))}));
const solutions = sets.map((s) => Array.from(arap.solve(Float32Array.from(s.pins))));
// how far the soft pins miss their targets at the posed keys (rest is exact: the solve returns the rest mesh)
const keyPinErr = sets.map((set, i) => {
  const at = arap.pinPositions(Float32Array.from(solutions[i]));
  let worst = 0;
  for (let k = 0; k < set.pins.length / 2; k++) worst = Math.max(worst, Math.hypot(at[2 * k] - set.pins[2 * k], at[2 * k + 1] - set.pins[2 * k + 1]));
  return {frame: set.frame, maxPinErrPx: +worst.toFixed(4)};
});
writeFileSync(outPath, JSON.stringify({mesh: {vertices: Array.from(mesh.vertices), triangles: Array.from(mesh.triangles)}, restPins: Array.from(pinsOf(restPose)), sets, solutions, droppedPins: arap.droppedPins}));

console.log(JSON.stringify({
  mesh: meshPath, vertices: V, triangles: mesh.triangles.length / 3, edges: arap.edgeCount, droppedPins: arap.droppedPins.map((p) => jointNames[p]),
  constructMs: +constructMs.toFixed(0), restIoUMesh: +restIoUMesh.toFixed(4), restIoUSolved: +restIoUSolved.toFixed(4),
  restMaxJointErrPx: +maxJoint.toExponential(2), restMaxVertexShiftPx: +maxVertex.toExponential(2),
  keyPinErr,
  solveMs: {n: times.length, median: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +times[times.length - 1].toFixed(2)},
}, null, 1));
