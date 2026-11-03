#!/usr/bin/env node
// The render manifest of a shot (row 6.12, D87): what each layer of the picture reads, the drawings each layer needs, and which frame shows which drawing.
// usage: node scripts/animation/render-manifest.mjs <shot-id> [--out out/<shot>/render-manifest.json]       exit 0 written, 2 input error
//
// A shot's picture is a stack of passes (src/scenes/shotS01Passes.ts), each drawn from a projection of the shot state; the manifest groups the passes into five layers:
//   figure  the parts rig (pose sheet, key sheet, plates, the family's parts, the rig's code)
//   props   the back (the field, the flood and motes under the picture, the Codex and the pieces behind the figure) and the front ( the gadget, the bubble, the box, Clawd, the stalk, the pop) (chart, light contract, staging, the beat's blocking); one drawing, because
//           the browser rasterises the layers inside one camera transform from everything they hold, so a prop drawn apart from the motes beside it is not the prop the whole frame draws (measured)
//   world   the title lockup (the beat's contracts and the mark)
//   light   the lamp's core and the grain over the picture (chart, light contract, staging)
//   light-sdf  the light as a signed-distance field (D98): the `occluders` pass draws every solid thing flat in its material's code colour, the `light-sdf` pass floods that mask into a distance field and lights the frame
//           from the emitter (falloff, soft shadow, one bounce) as stipple dots, on the GPU. It reads the figure and props layers (the occluders are drawn from the same projections: `layer:figure` and `layer:props`
//           in its inputs are those layers' cacheKeys, what a drawing of theirs reads at draw time), the light script, the material table, the shader source, and the BACKEND (`backend:name`: the browser's user agent
//           and the WebGL renderer, recorded per render, because a shader's bytes are a function of the GPU path as well as of its inputs)
//   camera  the pose of every frame (layout, chart span); it is baked into the drawings of every layer under it, so it is part of each drawing's id and has no drawings of its own
//           (resampling a drawing made at the identity camera does not match the browser's own raster at any zoom but 1: scripts/animation/README.md "Render cache", Camera)
// A drawing's id is the hash of its projection: two frames whose projection is the same JSON draw the same pixels. A layer's `inputsHash` is the hash of the files it reads (a
// path, or `path#a.b` for one subtree of a JSON file) and of the renderer's source closure; scripts/animation/probe-render-manifest.py recomputes it from the files on disk.
// A layer's `cacheKey` is the hash of the inputs a DRAWING reads at draw time, the layer's inputs less its `projectionOnly` ones: a file that only shapes the projection (the key and pose sheets
// of the figure) is already in the drawing's id through the joints it produced, so editing it names the layer stale but redraws only the drawings whose projection changed.
// This module only computes: `render-cached.mjs` renders what the cache lacks and writes the manifest with the output hashes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {loadTs, root} from './load-ts.mjs';

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);

/** The hash one input names: a file's bytes, or the canonical JSON of one subtree (`file#a.b`), `absent` when the file or subtree is not there. */
export const inputHash = (spec) => {
  const [file, sub] = spec.split('#');
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return 'absent';
  const bytes = fs.readFileSync(full);
  if (sub === undefined) return sha256(bytes);
  let node = JSON.parse(bytes.toString('utf8'));
  for (const k of sub.split('.')) node = node?.[k];
  return node === undefined ? 'absent' : sha256(canon(node));
};
/** The hash of a layer's inputs: one line per input, sorted. Python reproduces it (probe-render-manifest.py `inputs_hash`). */
export const hashInputs = (inputs) => sha256(Object.keys(inputs).sort().map((k) => `${k}=${inputs[k]}`).join('\n'));

/** The shots this renderer can cache. A shot names its pass module, its compositions and what each layer reads (paths relative to media/showcase; `#a.b` a subtree of a JSON file). */
const SHOTS = {
  's01-arrival-overwhelm': {
    passes: 'src/scenes/shotS01Passes.ts',
    composition: 'ShotS01',
    layerComposition: 'ShotS01Layer',
    figureComposition: 'ShotS01Figure',
    /** The renderer's source closure starts here; every src file it reaches is hashed into every layer (one codeVersion: a code edit misses every layer). */
    codeEntries: ['src/scenes/ShotS01.tsx', 'src/scenes/shotS01Passes.ts'],
    layers: (shot) => ({
      figure: {
        // the film's draw reads the parts, the mesh and the skeleton; the pose sheet and the key sheet only produce the joints in the projection, and the key plates (plates.json, K<n>.png) are the sheet's own pictures, which no composition here loads
        projectionOnly: [`v3/poses/${shot}.json`, `v3/keys/${shot}.json`, `assets/human/keys/${shot}/plates.json`, ...walk(path.join(root, `assets/human/keys/${shot}`)).filter((f) => f.endsWith('.png')).map(rel)],
        files: ['assets/human/mesh.json', 'assets/human/skeleton.json', `v3/poses/${shot}.json`, `v3/keys/${shot}.json`, `assets/human/keys/${shot}/plates.json`, ...walk(path.join(root, `assets/human/keys/${shot}`)).filter((f) => f.endsWith('.png')).map(rel), ...walk(path.join(root, 'assets/human/families/home/parts')).map(rel), ...walk(path.join(root, 'public/assets/human/families/home/parts')).map(rel), `${'v3/layouts'}/${shot}.json#staging.human`],
      },
      // the back (props, field and the light under them) is one drawing, so `props` reads what those three read; `light` is the lamp's core and the grain over the picture; `world` the title lockup and the beat's contracts
      props: {files: [`v3/charts/${shot}.json`, 'v3/light.json', `v3/layouts/${shot}.json#staging`, 'v3/blocking/test-scene.json', 'v3/worlds/home.json', 'v3/blocking/arrival.json', 'v3/blocking/everything-at-once.json', 'v3/timeline.json']},
      world: {files: ['v3/blocking/test-scene.json', 'v3/worlds/home.json', 'v3/blocking/arrival.json', 'v3/blocking/everything-at-once.json', 'v3/timeline.json', 'public/mark-reversed.svg']},
      light: {files: [`v3/charts/${shot}.json`, 'v3/light.json', `v3/layouts/${shot}.json#staging`, 'v3/blocking/arrival.json#emitter', 'v3/blocking/everything-at-once.json#emitter']},
      // the light as a signed-distance field: the occluder mask is drawn from the staging and the blocking (the figure and props layers' own draw-time inputs come in as `reads`), the light from the script, the materials and the shader
      'light-sdf': {
        files: [`v3/charts/${shot}.json`, 'v3/light.json', 'v3/materials.json', `v3/layouts/${shot}.json#staging`, 'v3/blocking/arrival.json', 'v3/blocking/everything-at-once.json', 'v3/timeline.json', 'src/library/light/sdfShaders.ts'],
        reads: ['figure', 'props'],
        backend: true,
      },
      camera: {files: [`v3/layouts/${shot}.json#cameraPose`, `v3/layouts/${shot}.json#figure`, `v3/layouts/${shot}.json#emitter`, `v3/charts/${shot}.json#camera`]},
    }),
  },
};
export const shotConfig = (shot) => SHOTS[shot];

/** The src files the renderer imports, from the entries: esbuild's own import graph (node_modules left out), so the list cannot miss an import. Data files under v3/ and assets/ are returned apart. */
export const sourceClosure = async (entries) => {
  const result = await build({entryPoints: entries.map((e) => path.join(root, e)), bundle: true, write: false, metafile: true, format: 'esm', platform: 'node', packages: 'external', logLevel: 'error', loader: {'.json': 'json'}, outdir: '/tmp/render-manifest-closure'});
  const all = Object.keys(result.metafile.inputs).map((p) => rel(path.resolve(root, p)));
  return {code: all.filter((p) => p.startsWith('src/')).sort(), data: all.filter((p) => !p.startsWith('src/')).sort()};
};

const camOf = (c) => ({x: c.x, y: c.y, zoom: c.zoom, rot: c.rotation});

/**
 * The manifest of `shot` before anything is rendered: layers with inputs and drawings (id, pass, frames), frames with their drawing ids, camera and parameters.
 * Everything the render fills in (output hashes, hit/miss, confirm) is left null/absent.
 */
export const computeManifest = async (shot, {backend} = {}) => {
  const cfg = SHOTS[shot];
  if (!cfg) throw new Error(`render-manifest: no renderer wiring for shot ${shot} (known: ${Object.keys(SHOTS).join(', ')})`);
  const mod = await loadTs(cfg.passes);
  const {PASSES, PASS_LAYER, PASS_INPUT, projectFrame, SHOT_FRAMES, magnifiedChangeOf} = mod;
  const [first, last] = SHOT_FRAMES;
  const closure = await sourceClosure(cfg.codeEntries);
  const declared = cfg.layers(shot);
  const declaredFiles = new Set(Object.values(declared).flatMap((l) => l.files.map((f) => f.split('#')[0])));
  const undeclared = closure.data.filter((f) => !declaredFiles.has(f));
  if (undeclared.length) throw new Error(`render-manifest: the renderer imports data no layer declares: ${undeclared.join(', ')} (add it to the layer that reads it in SHOTS)`);
  const code = Object.fromEntries(closure.code.map((f) => [f, inputHash(f)]));
  const codeVersion = hashInputs(code);

  const recorded = backend ?? readRecordedBackend(shot);
  const layers = {};
  for (const [name, spec] of Object.entries(declared)) {
    const inputs = {...Object.fromEntries([...new Set(spec.files)].sort().map((f) => [f, inputHash(f)])), [`code:${codeVersion.slice(0, 16)}`]: codeVersion};
    // a layer that reads other layers' drawings hashes what those drawings read at draw time (their cacheKey); a layer that is a shader hashes the backend it ran on
    for (const other of spec.reads ?? []) inputs[`layer:${other}`] = layers[other].cacheKey;
    if (spec.backend) inputs[BACKEND_INPUT] = backendHash(recorded);
    const projectionOnly = [...new Set(spec.projectionOnly ?? [])].filter((f) => f in inputs).sort();
    const drawingInputs = Object.fromEntries(Object.entries(inputs).filter(([k]) => !projectionOnly.includes(k)));
    layers[name] = {inputs, inputsHash: hashInputs(inputs), projectionOnly, cacheKey: hashInputs(drawingInputs), drawings: [], projections: {}, outputHash: null, status: null, ...(spec.backend ? {backend: recorded} : {})};
  }
  const byId = new Map();
  const frames = [];
  let previous = null;
  for (let frame = first; frame < last; frame++) {
    const {passes, params} = projectFrame(frame);
    const row = {frame, layers: {figure: [], props: [], world: [], light: [], 'light-sdf': [], camera: []}, camera: camOf(passes.figure.camera), magnification: Math.round(magnifiedChangeOf(previous, passes) * 1e4) / 1e4, params};
    previous = passes;
    const idOf = {};
    for (const pass of PASSES) {
      let p = passes[pass];
      if (!p) continue;
      const layer = PASS_LAYER[pass];
      // a pass that reads another pass's drawing names it in its projection: its id changes when that drawing does, and only then
      const input = PASS_INPUT[pass];
      if (input) {
        if (!idOf[input.pass]) throw new Error(`render-manifest: pass ${pass} reads ${input.pass}, which frame ${frame} does not draw`);
        p = {...p, [input.as]: idOf[input.pass]};
      }
      const id = `${pass}-${sha256(JSON.stringify(p)).slice(0, 12)}`;
      idOf[pass] = id;
      row.layers[layer].push(id);
      let d = byId.get(id);
      if (!d) {
        d = {id, pass, frames: [], outputHash: null};
        byId.set(id, d);
        layers[layer].drawings.push(d);
        layers[layer].projections[id] = p;
      }
      d.frames.push(frame);
    }
    frames.push(row);
  }
  return {shot, fps: 30, range: [first, last], codeVersion, codeFiles: closure.code, backend: recorded, layers, frames, config: cfg};
};

/** The input key a backend-dependent layer carries: its value is the hash of the backend's name (`backend.name`: user agent and WebGL renderer). */
export const BACKEND_INPUT = 'backend:name';
export const backendHash = (backend) => sha256(backend?.name ?? 'unrecorded');
/** The backend the last render of `shot` recorded, or null (nothing rendered yet, or rendered before the light layer existed). */
const readRecordedBackend = (shot) => {
  const p = path.join(root, 'out', shot, 'render-manifest.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).backend ?? null; } catch { return null; }
};
/** The manifest with the backend the browser reported: the layers that depend on it are hashed again (inputsHash, cacheKey), nothing else moves. */
export const withBackend = (m, backend) => {
  m.backend = backend;
  for (const [name, spec] of Object.entries(m.config.layers(m.shot))) {
    if (!spec.backend) continue;
    const L = m.layers[name];
    L.inputs[BACKEND_INPUT] = backendHash(backend);
    L.backend = backend;
    L.inputsHash = hashInputs(L.inputs);
    L.cacheKey = hashInputs(Object.fromEntries(Object.entries(L.inputs).filter(([k]) => !L.projectionOnly.includes(k))));
  }
  return m;
};

/** The manifest as written: layers without their projections (the renderer's input, not part of the record) and without the wiring. */
export const manifestDocument = (m, extra = {}) => ({
  shot: m.shot, fps: m.fps, range: m.range, codeVersion: m.codeVersion, codeFiles: m.codeFiles,
  backend: m.backend ?? null,
  layers: Object.fromEntries(Object.entries(m.layers).map(([k, l]) => [k, {inputs: l.inputs, inputsHash: l.inputsHash, projectionOnly: l.projectionOnly, cacheKey: l.cacheKey, drawings: l.drawings, outputHash: l.outputHash, status: l.status, ...(l.counts ? {counts: l.counts} : {}), ...(l.backend ? {backend: l.backend} : {})}])),
  frames: m.frames, ...extra,
});

/** The distinct camera poses of a manifest's frames (the camera layer's own count). */
export const distinctCameras = (frames) => new Set(frames.map((f) => JSON.stringify(f.camera))).size;

const main = async () => {
  const shot = process.argv[2];
  if (!shot || shot.startsWith('--')) {
    console.error('usage: render-manifest.mjs <shot-id> [--out path]');
    process.exit(2);
  }
  const i = process.argv.indexOf('--out');
  const out = path.resolve(root, i > -1 ? process.argv[i + 1] : `out/${shot}/render-manifest.json`);
  let m;
  try { m = await computeManifest(shot); } catch (e) { console.error(String(e.message ?? e)); process.exit(2); }
  const doc = manifestDocument(m);
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify(doc, null, 1) + '\n');
  console.log(`render manifest (inputs only, nothing rendered): ${path.relative(root, out)}`);
  for (const [k, l] of Object.entries(m.layers)) console.log(`  ${k.padEnd(7)} inputsHash ${l.inputsHash.slice(0, 12)}  ${String(l.drawings.length).padStart(4)} distinct drawings  (${Object.keys(l.inputs).length} inputs)`);
  console.log(`  backend: ${m.backend ? m.backend.name : 'not recorded yet (the first render records it; layers that depend on it hash "unrecorded" until then)'}`);
  console.log(`  camera poses: ${distinctCameras(m.frames)} distinct over ${m.frames.length} frames; codeVersion ${m.codeVersion.slice(0, 12)} (${m.codeFiles.length} source files)`);
};
if (import.meta.url === `file://${process.argv[1]}`) await main();
