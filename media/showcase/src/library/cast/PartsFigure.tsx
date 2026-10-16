import {useLayoutEffect, useMemo} from 'react';
import {staticFile} from 'remotion';
import {useLoader} from '@react-three/fiber';
import {
  BufferAttribute, BufferGeometry, DataTexture, DoubleSide, LinearFilter, NearestFilter, NoColorSpace, RedFormat, ShaderMaterial, SRGBColorSpace, TextureLoader, UnsignedByteType, type Texture,
} from 'three';
import partsFile from '../../../assets/human/families/home/parts/parts.json';
import type {Joints} from '../motion';
import {PartsRig, frontOf, parseParts, type PartName, type PartSpec, type PartsFile} from '../motion/partsRig';
import {restPose} from './humanPose';
import {maskToWorld} from './figureSpace';

/**
 * The human as the parts rig (row 6.9, D85): the home plate cut by its skeleton into parts (scripts/animation/cut-parts.mjs), each part its own ARAP mesh pinned at its bone's
 * joints (src/library/motion/partsRig.ts: the pins and the order are the code scripts/animation/plates-from-poses.mjs runs for the key plates), drawn in `order`, front first.
 * A limb across the torso, a folded arm or a raised one is held by the order the parts are drawn in, not by tearing one sheet. Where two parts meet each reaches into the other; the part in
 * front fades out across its reach (the part's `ramp` picture, 1 minus the ramp where the pixel belongs to a part it is in front of), so a joint is a soft overlap and not a cut.
 * Pose and order are props: this component draws, it decides nothing.
 */
const parts: PartsFile = parseParts(partsFile, restPose);
const rig = new PartsRig(parts, restPose);
const PLATE = {w: 1536, h: 1024};

const vertex = /* glsl */ `
attribute vec2 rest;
varying vec2 vUv;
varying vec2 vRest;
void main() {
  vUv = uv;
  vRest = rest;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// alpha = the part's own pixels x (1 - fade), the fade being the part's ramp where the pixel belongs to a part this one is drawn in front of (`front`, one byte per part id; id 0 is the background)
const fragment = /* glsl */ `
uniform sampler2D map;
uniform sampler2D ramp;
uniform sampler2D owners;
uniform sampler2D front;
uniform float parts;
varying vec2 vUv;
varying vec2 vRest;
void main() {
  vec4 c = texture2D(map, vUv);
  float id = floor(texture2D(owners, vRest / vec2(${PLATE.w}.0, ${PLATE.h}.0)).r * 255.0 + 0.5);
  float inFront = texture2D(front, vec2((id + 0.5) / (parts + 1.0), 0.5)).r;
  float a = c.a * (1.0 - texture2D(ramp, vUv).r * inFront);
  if (a < 0.02) discard;
  gl_FragColor = vec4(c.rgb, a);
  #include <colorspace_fragment>
}`;

const useTextures = (): {map: Texture[]; ramp: Texture[]; owners: Texture} => {
  const urls = useMemo(() => [...parts.parts.map((p) => staticFile(`assets/human/families/home/parts/${p.png}`)), ...parts.parts.map((p) => staticFile(`assets/human/families/home/parts/${p.ramp}`)), staticFile(`assets/human/families/home/parts/${parts.owners}`)], []);
  const all = useLoader(TextureLoader, urls);
  const n = parts.parts.length;
  return useMemo(() => {
    const map = all.slice(0, n), ramp = all.slice(n, 2 * n), owners = all[2 * n]!;
    for (const t of map) { t.flipY = false; t.colorSpace = SRGBColorSpace; t.minFilter = LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; }
    for (const t of ramp) { t.flipY = false; t.colorSpace = NoColorSpace; t.minFilter = LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; }
    owners.flipY = false; owners.colorSpace = NoColorSpace; owners.minFilter = NearestFilter; owners.magFilter = NearestFilter; owners.generateMipmaps = false; owners.needsUpdate = true;
    return {map, ramp, owners};
  }, [all, n]);
};

type PartDraw = {spec: PartSpec; geometry: BufferGeometry; material: ShaderMaterial; front: DataTexture};

const useDraws = (textures: {map: Texture[]; ramp: Texture[]; owners: Texture}): PartDraw[] =>
  useMemo(
    () =>
      parts.parts.map((spec, i) => {
        const geometry = new BufferGeometry();
        const position = new Float32Array((3 * spec.mesh.vertices.length) / 2);
        maskToWorld(spec.mesh.vertices, position);
        geometry.setAttribute('position', new BufferAttribute(position, 3));
        geometry.setAttribute('uv', new BufferAttribute(Float32Array.from(spec.mesh.uvs), 2));
        geometry.setAttribute('rest', new BufferAttribute(Float32Array.from(spec.mesh.vertices), 2));
        geometry.setIndex(new BufferAttribute(Uint32Array.from(spec.mesh.triangles), 1));
        const front = new DataTexture(new Uint8Array(parts.parts.length + 1), parts.parts.length + 1, 1, RedFormat, UnsignedByteType);
        front.magFilter = NearestFilter; front.minFilter = NearestFilter; front.generateMipmaps = false; front.needsUpdate = true;
        const material = new ShaderMaterial({
          uniforms: {map: {value: textures.map[i]}, ramp: {value: textures.ramp[i]}, owners: {value: textures.owners}, front: {value: front}, parts: {value: parts.parts.length}},
          vertexShader: vertex, fragmentShader: fragment, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: DoubleSide,
        });
        return {spec, geometry, material, front};
      }),
    [textures],
  );

/** The parts rig inside a ThreeCanvas laid out like MeshFigure's (HumanPuppet canvas units, y up): re-solved and re-ordered on every render. */
export const PartsMesh: React.FC<{pose: Joints; order: readonly PartName[]}> = ({pose, order}) => {
  const draws = useDraws(useTextures());
  // layout effects run before ThreeCanvas advances the frame, so the render sees this frame's positions and order
  useLayoutEffect(() => {
    const solved = rig.pose(pose);
    for (const {spec, geometry, front} of draws) {
      const position = geometry.getAttribute('position') as BufferAttribute;
      maskToWorld(solved[spec.name], position.array as Float32Array);
      position.needsUpdate = true;
      (front.image.data as Uint8Array).set(frontOf(parts, order, spec.name).map((v) => v * 255));
      front.needsUpdate = true;
    }
  });
  return (
    <>
      {draws.map(({spec, geometry, material}) => (
        <mesh key={spec.name} geometry={geometry} material={material} frustumCulled={false} renderOrder={order.length - order.indexOf(spec.name)} />
      ))}
    </>
  );
};
