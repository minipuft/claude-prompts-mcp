import {ThreeCanvas} from '@remotion/three';
import {useMemo} from 'react';
import {useCurrentFrame} from 'remotion';
import * as THREE from 'three';
import type {Palette} from '../tokens';
import {LightString, NestedFrames, Silhouette, Stalk, blobShape} from './seuss';

/** Deterministic PRNG shared with Radiance (mulberry32). */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Radial gradient texture for the additive emitter sprite; built once, from the palette's bands. */
const useGlowTexture = (bands: string[]) =>
  useMemo(() => {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    bands.forEach((b, i) => g.addColorStop((i / bands.length) * 0.9, b));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [bands.join(',')]);

/** Grained multi-hue field (Midnight Gospel cosmos/junkyard sky): diagonal hue smear plus seeded speckle at two scales, built once. */
const useFieldTexture = (bands: string[], seed: number) =>
  useMemo(() => {
    const w = 512;
    const h = 384;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#07060c';
    ctx.fillRect(0, 0, w, h);
    // one large blue cloud mass, grained (Seuss night sky); bands[bands.length-1] is the coolest band
    const cloud = ctx.createRadialGradient(w * 0.38, h * 0.3, 10, w * 0.38, h * 0.3, w * 0.42);
    cloud.addColorStop(0, bands[bands.length - 1] ?? '#2bc9ff');
    cloud.addColorStop(0.55, bands[bands.length - 2] ?? '#1f6fff');
    cloud.addColorStop(1, 'rgba(7,6,12,0)');
    ctx.fillStyle = cloud;
    ctx.beginPath();
    ctx.ellipse(w * 0.38, h * 0.3, w * 0.4, h * 0.34, -0.15, 0, Math.PI * 2);
    ctx.fill();
    const rnd = seeded(seed);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    // fine speckle: per-pixel luminance jitter
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 34;
      d[i] = Math.max(0, Math.min(255, (d[i] ?? 0) + n));
      d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] ?? 0) + n));
      d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] ?? 0) + n));
    }
    ctx.putImageData(img, 0, 0);
    // coarse splatter: sparse dots of varying size in the band colors
    // sparse colored stars, as in the Seuss night sky
    for (let i = 0; i < 140; i++) {
      ctx.fillStyle = i % 5 === 0 ? (bands[1] ?? '#ffb15c') : '#f4f0ff';
      ctx.globalAlpha = 0.5 + rnd() * 0.5;
      ctx.beginPath();
      ctx.arc(rnd() * w, rnd() * h, 0.6 + rnd() * rnd() * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [bands.join(','), seed]);

/** Ground stipple (Midnight Gospel shadow law): transparent dots whose density grows toward the top edge; seeded. */
const useStippleTexture = (color: string, seed: number) =>
  useMemo(() => {
    const w = 512;
    const h = 96;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const rnd = seeded(seed);
    ctx.fillStyle = color;
    for (let i = 0; i < 16000; i++) {
      const y = rnd() * h;
      if (rnd() > 1 - (y / h) * 0.95) continue; // sparse at the bottom, dense at the top
      ctx.globalAlpha = 0.7 + rnd() * 0.3;
      const d = 2 + (rnd() < 0.2 ? 3 : 0);
      ctx.fillRect(rnd() * w, h - y, d, d);
    }
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }, [color, seed]);

/** Film grain over the glass: tileable seeded speckle, additive at low alpha. */
const useGrainTexture = (seed: number) =>
  useMemo(() => {
    const n = 256;
    const c = document.createElement('canvas');
    c.width = n;
    c.height = n;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(n, n);
    const rnd = seeded(seed);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = rnd() < 0.18 ? 140 + rnd() * 115 : 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(7, 5);
    return tex;
  }, [seed]);

type Props = {width: number; height: number; palette: Palette; reveal: number; seed?: number; joinA?: number; joinB?: number; pulseA?: number; pulseB?: number};

/**
 * The world inside the frame (D45, D46): the assembled environment seen through glass.
 * Glass = a warped transmissive plane in front of the camera; transmission refracts the scene behind it,
 * roughness diffuses it, dispersion shifts the edges. `reveal` 0..1 clears the glass as the frame is raised.
 */
export const FrameInterior: React.FC<Props> = ({width, height, palette, reveal, seed = 11, joinA = 1, joinB = 1, pulseA = 0, pulseB = 0}) => {
  const frame = useCurrentFrame();
  const glow = useGlowTexture(palette.bands);
  const field = useFieldTexture(palette.bands, seed + 5);
  const grain = useGrainTexture(seed + 9);
  const stipple = useStippleTexture(palette.kit.main2, seed + 13);
  const rnd = useMemo(() => seeded(seed), [seed]);
  const towerA = useMemo(() => blobShape([[-0.9, 0], [-1.1, 1.4], [-0.5, 2.6], [0.2, 3.9], [-0.3, 4.6], [0.6, 4.2], [0.9, 2.8], [0.6, 1.2], [0.8, 0]]), []);
  const towerB = useMemo(() => blobShape([[-0.7, 0], [-1.0, 1.1], [-0.4, 2.0], [-0.9, 3.0], [0.1, 3.5], [0.7, 2.6], [0.4, 1.6], [0.9, 0.6], [0.7, 0]]), []);
  const towerC = useMemo(() => blobShape([[-1.3, 0], [-1.2, 1.8], [-0.2, 2.6], [0.3, 4.2], [0.9, 2.4], [1.4, 1.2], [1.2, 0]]), []);
  const ground = useMemo(() => blobShape([[-5.5, 0], [-4, 0.5], [-1.5, 0.2], [1, 0.7], [3.5, 0.3], [5.5, 0.5], [5.5, -1.2], [-5.5, -1.2]]), []);
  const motes = useMemo(() => Array.from({length: 24}, () => [rnd() * 14 - 7, rnd() * 8 - 2, rnd() * -10 - 1, 0.08 + rnd() * 0.18] as const), [rnd]);
  // warped glass: low-frequency displacement baked into the geometry once
  const glassGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(9, 6, 48, 32);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      pos.setZ(i, 0.15 * Math.sin(x * 1.1 + 0.7) * Math.cos(y * 1.4 - 0.4) + 0.06 * Math.sin(x * 3.7 + y) * Math.sin(y * 2.9));
    }
    g.computeVertexNormals();
    return g;
  }, []);
  const roughness = 0.5 - 0.42 * reveal;
  const slow = frame / 240;
  return (
    <ThreeCanvas width={width} height={height} gl={{alpha: true, antialias: true}} camera={{fov: 42, position: [0, 1.2, 7.5]}} style={{background: 'transparent'}}>
      {/* lights only matter to the glass; pieces are flat MeshBasic */}
      <ambientLight intensity={0.6} />
      <pointLight position={[0, 2.5, -2]} intensity={6} color={palette.emitter} />
      {/* grained night field far behind everything: black, one blue cloud mass, sparse stars (D44, D50) */}
      <mesh position={[0, 1, -16]}>
        <planeGeometry args={[34, 24]} />
        <meshBasicMaterial map={field} />
      </mesh>
      {/* the environment (D50): receding turned frames, swooping towers, stalks, a beaded light string */}
      <group position={[0, 0.2, -3]}>
        <NestedFrames count={7} color={palette.gadget.accent} outline={palette.gadget.light} depth={1.6} turn={0.07} />
      </group>
      <group position={[0, -2.4, -3.0]} rotation={[0, slow * 0.15 - 0.05, 0]}>
        {/* beat 5: towerA slides in from the left, the second stalk rises; each join lands with a seam pulse */}
        <Silhouette shape={towerA} fill={palette.kit.main1} outline={palette.kit.light} position={[-4.2 - (1 - joinA) * 7, 0, -1.6]} scale={1.05} />
        <mesh position={[-3.2, 0.1, -1.5]} scale={[1 + pulseA * 1.6, 0.25 + pulseA * 0.6, 1]}>
          <circleGeometry args={[0.9, 24]} />
          <meshBasicMaterial color={palette.emitter} transparent opacity={pulseA * 0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh position={[0.4 - 0.7 * 0.6, 0.2, 1.02]} scale={[1 + pulseB * 1.4, 0.2 + pulseB * 0.5, 1]}>
          <circleGeometry args={[0.6, 24]} />
          <meshBasicMaterial color={palette.emitter} transparent opacity={pulseB * 0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        <Silhouette shape={towerB} fill={palette.kit.main2} outline={palette.kit.light} position={[4.3, 0, -2.2]} scale={1.1} />
        <Silhouette shape={towerC} fill={palette.kit.shadow} outline={palette.kit.light} position={[-2.4, 0, -4.2]} scale={0.75} />
        <Silhouette shape={ground} fill={palette.kit.shadow} outline={palette.kit.main1} position={[0, -0.2, 0.8]} />
        <mesh position={[0, -0.05, 0.85]}>
          <planeGeometry args={[11, 2.0]} />
          <meshBasicMaterial map={stipple} transparent depthWrite={false} />
        </mesh>
        <Stalk base={[-2.6, 0.2, 0.9]} height={2.4} lean={0.9} color={palette.kit.light} leaf={palette.kit.accent} />
        <Stalk base={[0.4, 0.1, 1.0]} height={1.7 * Math.max(0.02, joinB)} lean={-0.7} color={palette.kit.light} leaf={palette.gadget.light} />
        <Stalk base={[2.9, 0.3, 0.4]} height={2.9} lean={0.4} color={palette.kit.main2} leaf={palette.kit.accent} />
        <LightString from={[-4.4, 3.4, 2.2]} to={[4.2, 4.0, 2.0]} sag={1.1} beads={26} map={glow} size={0.26} />
      </group>
      {/* emitter: one additive glow sprite directly behind the environment so it rims the pieces */}
      <sprite position={[0.3, 0.2, -5.2]} scale={[5, 5, 1]}>
        <spriteMaterial map={glow} blending={THREE.AdditiveBlending} depthWrite={false} transparent opacity={0.75} />
      </sprite>
      {/* motes: additive points drifting, seeded */}
      {motes.map(([x, y, z, s], i) => (
        <sprite key={i} position={[x + Math.sin(slow * 2 + i) * 0.2, y + ((frame * 0.004 * (1 + (i % 3))) % 6), z]} scale={[s, s, 1]}>
          <spriteMaterial map={glow} blending={THREE.AdditiveBlending} depthWrite={false} transparent opacity={0.5} />
        </sprite>
      ))}
      {/* film grain over the glass, additive, low alpha */}
      <mesh position={[0, 0.6, 4.4]}>
        <planeGeometry args={[9.5, 6.4]} />
        <meshBasicMaterial map={grain} blending={THREE.AdditiveBlending} transparent opacity={0.06} depthWrite={false} />
      </mesh>
      {/* the glass */}
      <mesh geometry={glassGeo} position={[0, 0.6, 3.2]}>
        <meshPhysicalMaterial
          color="#ffffff"
          transmission={1}
          roughness={roughness}
          ior={1.45}
          thickness={2.2}
          dispersion={1.2}
          iridescence={0.35}
          iridescenceIOR={1.3}
          metalness={0}
          transparent
        />
      </mesh>
    </ThreeCanvas>
  );
};
