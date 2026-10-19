/**
 * The light layer's driver: one three.js full-screen quad drawn in three programs (mask -> seeds, jump flood, light) on a canvas the caller owns (D98). Browser only; the contract is `sdf.ts`, the programs
 * `sdfShaders.ts`. Nothing here reads a clock or a random number: the same mask and the same `SdfP` on the same backend give the same bytes.
 */
import * as THREE from 'three';
import {BLUE_NOISE_SIZE, blueNoise} from './blueNoise';
import {GROUP_ORDER, SDF, SDF_SIZE, ownerSeatOf, sdfUniforms, type SdfP} from './sdf';
import {FLOOD_FRAG, LIGHT_FRAG, SEED_FRAG, VERT} from './sdfShaders';

const {width: W, height: H} = SDF_SIZE;

/** Passes of the flood: the step halves from the largest power of two under the width down to 1, log2(width) rounded up (11 for 1280). */
export const floodSteps = (width: number): number[] => {
  const out: number[] = [];
  for (let s = 2 ** Math.ceil(Math.log2(width) - 1); s >= 1; s /= 2) out.push(s);
  return out;
};

/** The mask a drawing reads, as the texture holds it: RGBA bytes, rows bottom-up. `image` is the occluders pass at full frame, or null for no solid at all. */
export const maskFromImage = (image: CanvasImageSource | null): Uint8Array => {
  const out = new Uint8Array(W * H * 4);
  if (!image) return out;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', {willReadFrequently: true})!;
  ctx.drawImage(image, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  for (let y = 0; y < H; y++) {
    const from = y * W * 4, to = (H - 1 - y) * W * 4;
    for (let x = 0; x < W * 4; x += 4) {
      // alpha thresholded at a half: a semi-transparent rim is either a solid pixel or not, never a blend of two codes
      if (px[from + x + 3]! < 128) continue;
      out[to + x] = px[from + x]!; out[to + x + 1] = px[from + x + 1]!; out[to + x + 2] = px[from + x + 2]!; out[to + x + 3] = 255;
    }
  }
  return out;
};

/** The group of the solid the emitter sits in: the mask's group at the emitter, or the nearest solid within 6 px of it, or -1 (a free emitter). */
export const ownerGroup = (mask: Uint8Array, emitter: [number, number]): number => {
  const ex = Math.floor(emitter[0]), ey = Math.floor(emitter[1]);
  let best = -1, bestD = Infinity;
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    const x = ex + dx, y = ey + dy;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = (y * W + x) * 4;
    if (mask[i + 3]! < 128 || mask[i + 1]! === 0) continue;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = Math.floor(mask[i + 2]! / 32); }
  }
  return best;
};

const dataTexture = (data: Uint8Array, w: number, h: number): THREE.DataTexture => {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
};

const floatTarget = () => new THREE.WebGLRenderTarget(W, H, {type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false});

/** Draws the light layer onto `canvas` (W x H): dots of the light on a transparent background. Returns what it drew with, for the report. */
export const drawLightSdf = (canvas: HTMLCanvasElement, p: SdfP, mask: Uint8Array): {passes: number} => {
  const renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, premultipliedAlpha: true});
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  scene.add(quad);
  const material = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending});
  const maskTex = dataTexture(mask, W, H);
  const noiseTex = (() => { const t = blueNoise(), d = new Uint8Array(t.length * 4); for (let i = 0; i < t.length; i++) { d[i * 4] = t[i]!; d[i * 4 + 3] = 255; } return dataTexture(d, BLUE_NOISE_SIZE, BLUE_NOISE_SIZE); })();
  const size = new THREE.Vector2(W, H);
  const seedMat = material(SEED_FRAG, {uMask: {value: maskTex}});
  const floodMat = material(FLOOD_FRAG, {uSeeds: {value: null}, uSize: {value: size}, uStep: {value: 1}});
  const u = sdfUniforms(p);
  const owner = ownerGroup(mask, u.emitter);
  const lightMat = material(LIGHT_FRAG, {
    uMask: {value: maskTex}, uSeeds: {value: null}, uNoise: {value: noiseTex}, uSize: {value: size},
    uEmitter: {value: new THREE.Vector2(...u.emitter)}, uSeat: {value: u.emitterSeat}, uR0: {value: u.r0}, uReach: {value: u.reach}, uFloor: {value: u.floor}, uGuard: {value: SDF.guardPx},
    uDot: {value: new THREE.Vector3(...u.dot)}, uRadiance: {value: new THREE.Vector3(...u.radiance)}, uAccent: {value: new THREE.Vector3(...u.accent)},
    uGroupAccent: {value: u.groupAccent}, uOwner: {value: owner}, uOwnerSeat: {value: ownerSeatOf(GROUP_ORDER[owner], p.zoom)},
    uShadowK: {value: new THREE.Vector3(SDF.shadowK[1], SDF.shadowK[2], SDF.shadowK[3])}, uStipplePx: {value: new THREE.Vector3(SDF.stipplePx[1], SDF.stipplePx[2], SDF.stipplePx[3])},
    uBounceGain: {value: SDF.bounce.gain}, uBounceReach: {value: SDF.bounce.reachPx}, uBounceLuma: {value: u.bounceLuma}, uStepsFine: {value: SDF.stepsFine}, uStepsCoarse: {value: SDF.stepsCoarse},
  });
  let read = floatTarget(), write = floatTarget();
  const run = (mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(scene, camera); };
  run(seedMat, read);
  const steps = floodSteps(W);
  for (const s of steps) {
    floodMat.uniforms.uSeeds!.value = read.texture; floodMat.uniforms.uStep!.value = s;
    run(floodMat, write);
    [read, write] = [write, read];
  }
  lightMat.uniforms.uSeeds!.value = read.texture;
  renderer.setClearColor(0x000000, 0);
  run(lightMat, null);
  for (const t of [read, write]) t.dispose();
  for (const m of [seedMat, floodMat, lightMat]) m.dispose();
  maskTex.dispose(); noiseTex.dispose(); quad.geometry.dispose();
  renderer.dispose();
  return {passes: 1 + steps.length + 1};
};
