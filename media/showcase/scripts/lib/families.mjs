// Plate families (D73 sibling meshes, D85): a plate family is a mesh built from one drawn plate with its own skeleton registration.
//   assets/<actor>/families/<family>/plate.png    the drawn plate, RGBA, the mesh's texture (uv = mesh position / mesh width, height)
//   assets/<actor>/families/<family>/mesh.json    the plate's mask triangulated by maskToMesh: {width, height, region, simplify, gridSpacing, vertices, triangles, uvs}
//   assets/<actor>/families/<family>/joints.json  {family, actor, silhouette, registration, method, restHeightPx, plateSha256, meshSha256, joints: {name: [x, y]}, parents}
// `registration` says how the joints got onto the plate and is never "by eye": "skeleton" (the actor's own skeleton file, the home family), "toolchain" (a skeleton
// toolchain's output, numeric gate passed) or "fit" (the pose sheet's solved joints of the plate's own key fitted to the plate's mask by scale and translation only,
// `fit` carries the numbers). A reader that must tell the three apart reads `registration`; `scripts/animation/probe-poses.py` and the keys table report it.
// `loadFamily` refuses a family whose files no longer match the hashes it recorded, and a skeleton-registered family whose `source` files moved.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const REGISTRATIONS = ['skeleton', 'toolchain', 'fit'];
const REQUIRED = ['family', 'actor', 'silhouette', 'registration', 'method', 'restHeightPx', 'plateSha256', 'meshSha256', 'joints'];

export const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const familiesDir = (root, actor) => path.join(root, 'assets', actor, 'families');

/** The family ids of an actor: every directory of assets/<actor>/families that has a joints.json. */
export const listFamilies = (root, actor) => {
  const dir = familiesDir(root, actor);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((id) => fs.existsSync(path.join(dir, id, 'joints.json'))).sort();
};

/**
 * One family, verified: the plate and the mesh match the hashes joints.json recorded, a family that names its `source` files still matches them (the home family
 * is a copy of assets/human/{cutout.png, mesh.json}: a copy that drifted is a second asset), and every joint lies inside the mesh's region.
 * Returns {id, dir, platePath, meshPath, meta, restPose, mesh: {vertices: Float32Array, triangles: Uint32Array, uvs: Float32Array, width, height}}.
 */
export const loadFamily = (root, actor, id) => {
  const dir = path.join(familiesDir(root, actor), id);
  const jointsPath = path.join(dir, 'joints.json');
  if (!fs.existsSync(jointsPath)) throw new Error(`family ${actor}/${id}: ${path.relative(root, jointsPath)} does not exist`);
  const meta = JSON.parse(fs.readFileSync(jointsPath, 'utf8'));
  const missing = REQUIRED.filter((k) => meta[k] === undefined);
  if (missing.length) throw new Error(`family ${actor}/${id}: joints.json lacks ${missing.join(', ')}`);
  if (meta.family !== id) throw new Error(`family ${actor}/${id}: joints.json names family "${meta.family}"`);
  if (!REGISTRATIONS.includes(meta.registration)) throw new Error(`family ${actor}/${id}: registration "${meta.registration}" is not one of ${REGISTRATIONS.join(', ')}`);
  if (meta.registration === 'fit' && !meta.fit) throw new Error(`family ${actor}/${id}: registration "fit" carries no \`fit\` numbers`);
  const platePath = path.join(dir, 'plate.png'), meshPath = path.join(dir, 'mesh.json');
  if (sha256(platePath) !== meta.plateSha256) throw new Error(`family ${actor}/${id}: plate.png no longer matches the plateSha256 its joints.json recorded`);
  if (sha256(meshPath) !== meta.meshSha256) throw new Error(`family ${actor}/${id}: mesh.json no longer matches the meshSha256 its joints.json recorded`);
  for (const [what, rel] of Object.entries(meta.source ?? {})) {
    const target = {plate: platePath, mesh: meshPath}[what];
    if (target && sha256(path.join(root, rel)) !== sha256(target)) throw new Error(`family ${actor}/${id}: ${path.relative(root, target)} is no longer a copy of ${rel}`);
  }
  const raw = JSON.parse(fs.readFileSync(meshPath, 'utf8'));
  const mesh = {vertices: Float32Array.from(raw.vertices), triangles: Uint32Array.from(raw.triangles), uvs: Float32Array.from(raw.uvs), width: raw.width, height: raw.height};
  const [x0, y0, x1, y1] = raw.region ?? [0, 0, raw.width, raw.height];
  const outside = Object.entries(meta.joints).filter(([, [x, y]]) => x < x0 - 1 || y < y0 - 1 || x > x1 + 1 || y > y1 + 1).map(([n]) => n);
  if (outside.length) throw new Error(`family ${actor}/${id}: joints ${outside.join(', ')} lie outside the mesh region [${[x0, y0, x1, y1]}]`);
  return {id, dir, platePath, meshPath, meta, restPose: meta.joints, mesh};
};
