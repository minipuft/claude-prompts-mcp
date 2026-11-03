#!/usr/bin/env node
// Cuts a plate family into the parts the parts rig poses and draws (row 6.9, D85): the home plate and its skeleton joints -> assets/<actor>/families/<family>/parts/.
// usage: node scripts/animation/cut-parts.mjs [<actor> [<family>]]     (npm run parts)     exit 0 written, 2 input error
//   1. cut_parts.py gives every pixel of the plate to a part (the plate's own contour lines, the skeleton's bone planes and distances), reaches each part into its neighbours by a slab and a
//      joint cap, completes the tops of the upper legs, and writes <part>.png, <part>.ramp.png, owners.png and a draft parts.json;
//   2. each part's pixels (its own cell and its reach) are triangulated by maskToMesh, the mesher of the home mesh (mesh space = the plate's mask space; uvs are relative to the part's
//      PNG), and parts.json is finished with the meshes and the file hashes `loadParts` (scripts/lib/parts.mjs) checks; the pictures are mirrored under public/ for the film.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {loadTs, root} from './load-ts.mjs';
import {readGrayPng} from '../lib/png-gray.mjs';
import {sha256} from '../lib/families.mjs';

const actor = process.argv[2] ?? 'human', family = process.argv[3] ?? 'home';
const dir = path.join(root, 'assets', actor, 'families', family);
if (!fs.existsSync(path.join(dir, 'plate.png'))) { console.error(`input error: ${path.relative(root, dir)}/plate.png does not exist`); process.exit(2); }
const work = path.join(root, 'out', 'parts-work');
fs.mkdirSync(work, {recursive: true});
const draftPath = path.join(work, 'parts-draft.json');
const cut = spawnSync('python3', [path.join(root, 'scripts/animation/cut_parts.py'), draftPath, actor, family], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
process.stdout.write(cut.stdout);
if (cut.status !== 0) process.exit(cut.status === 2 ? 2 : 1);

const {maskToMesh} = await loadTs('src/library/motion/mesh.ts');
const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
const round = (a, d) => Array.from(a, (v) => Math.round(v * d) / d);
const GRID = 14, SIMPLIFY = 1.2;
let vertices = 0, triangles = 0;
for (const part of draft.parts) {
  const mask = readGrayPng(path.join(work, `${part.name}.mask.png`));
  const mesh = maskToMesh(mask, {region: [0, 0, mask.width, mask.height], simplify: SIMPLIFY, gridSpacing: GRID});
  const [ox, oy] = part.offset;
  const world = Array.from(mesh.vertices, (v, i) => v + (i % 2 === 0 ? ox : oy));
  part.mesh = {vertices: round(world, 100), triangles: Array.from(mesh.triangles), uvs: round(mesh.uvs, 1e5)};
  part.sha256 = {png: sha256(path.join(dir, 'parts', part.png)), ramp: sha256(path.join(dir, 'parts', part.ramp))};
  vertices += mesh.stats.vertices; triangles += mesh.stats.triangles;
}
draft.ownersSha256 = sha256(path.join(dir, 'parts', 'owners.png'));
draft.meshing = {gridSpacing: GRID, simplify: SIMPLIFY, note: 'maskToMesh over each part\'s pixels (src/library/motion/mesh.ts); vertices are in the plate\'s mask space, uvs are relative to the part\'s PNG'};
// numbers on one line: the meshes would otherwise be a column of 10 000 lines
const text = JSON.stringify(draft, null, 1).replace(/\[\s*(-?[\d.e+-]+(?:,\s*-?[\d.e+-]+)*)\s*\]/g, (_, a) => `[${a.replace(/\s+/g, '')}]`);
fs.writeFileSync(path.join(dir, 'parts', 'parts.json'), text + '\n');
// the film loads the part pictures by staticFile: public/ mirrors assets/<actor>/families/<family>/parts
const mirror = path.join(root, 'public', 'assets', actor, 'families', family, 'parts');
fs.rmSync(mirror, {recursive: true, force: true});
fs.mkdirSync(mirror, {recursive: true});
for (const f of fs.readdirSync(path.join(dir, 'parts')).filter((f) => f.endsWith('.png'))) fs.copyFileSync(path.join(dir, 'parts', f), path.join(mirror, f));
console.log(`wrote ${draft.parts.length} parts (${vertices} vertices, ${triangles} triangles) to ${path.relative(root, path.join(dir, 'parts'))}`);
