import {useMemo} from 'react';
import * as THREE from 'three';

/**
 * Seuss Midnight Paintings grammar (D50): flat silhouettes in depth, pale contour outlines on black,
 * receding turned frames, swooping towers, curling stalks with flag leaves, beaded light strings.
 * Everything is a flat shape at a depth; parallax comes from the camera, never from shading.
 */

/** A closed blobby profile from control points; Seuss towers lean and swell, so the points are hand-authored. */
export const blobShape = (pts: Array<[number, number]>): THREE.Shape => {
  const s = new THREE.Shape();
  const n = pts.length;
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const first = mid(pts[n - 1]!, pts[0]!);
  s.moveTo(first[0], first[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % n]!;
    const m = mid(p, q);
    s.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  s.closePath();
  return s;
};

/** Flat silhouette with a pale contour: the outline is the same shape, slightly larger, one step behind. */
export const Silhouette: React.FC<{shape: THREE.Shape; fill: string; outline: string; position: [number, number, number]; rotation?: number; scale?: number}> = ({shape, fill, outline, position, rotation = 0, scale = 1}) => {
  const geo = useMemo(() => new THREE.ShapeGeometry(shape), [shape]);
  return (
    <group position={position} rotation={[0, 0, rotation]} scale={scale}>
      <mesh position={[0, 0, -0.02]} scale={1.04}>
        <primitive object={geo} attach="geometry" />
        <meshBasicMaterial color={outline} />
      </mesh>
      <mesh>
        <primitive object={geo} attach="geometry" />
        <meshBasicMaterial color={fill} />
      </mesh>
    </group>
  );
};

/** One hand-drawn rectangular frame ring: a rectangle with a hole, corners slightly uneven. */
export const frameRing = (w: number, h: number, t: number, wobble: number): THREE.Shape => {
  const s = new THREE.Shape();
  const j = (v: number, k: number) => v + wobble * Math.sin(k * 2.3) * 0.5;
  s.moveTo(j(-w / 2, 1), j(-h / 2, 2));
  s.lineTo(j(w / 2, 3), j(-h / 2, 4));
  s.lineTo(j(w / 2, 5), j(h / 2, 6));
  s.lineTo(j(-w / 2, 7), j(h / 2, 8));
  s.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-w / 2 + t, -h / 2 + t);
  hole.lineTo(w / 2 - t, -h / 2 + t);
  hole.lineTo(w / 2 - t, h / 2 - t);
  hole.lineTo(-w / 2 + t, h / 2 - t);
  hole.closePath();
  s.holes.push(hole);
  return s;
};

/** Receding turned frames: the nested-frames painting. Each ring is smaller, deeper and turned a little more. */
export const NestedFrames: React.FC<{count: number; color: string; outline: string; depth: number; turn: number}> = ({count, color, outline, depth, turn}) => {
  const rings = useMemo(
    () =>
      Array.from({length: count}, (_, i) => {
        const k = i / count;
        return {shape: frameRing(8 * (1 - k * 0.82), 5.4 * (1 - k * 0.82), 0.16 * (1 - k * 0.5), 0.12 + k * 0.2), z: -i * depth, rot: turn * i, k};
      }),
    [count, depth, turn],
  );
  return (
    <>
      {rings.map((r, i) => (
        <Silhouette key={i} shape={r.shape} fill={color} outline={outline} position={[0.15 * i, 0.08 * i, r.z]} rotation={r.rot} />
      ))}
    </>
  );
};

/** A curling stalk with a flag leaf at the tip. */
export const Stalk: React.FC<{base: [number, number, number]; height: number; lean: number; color: string; leaf: string}> = ({base, height, lean, color, leaf}) => {
  const tube = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(lean * 0.3, height * 0.45, 0),
      new THREE.Vector3(lean * 0.9, height * 0.8, 0),
      new THREE.Vector3(lean * 0.6, height, 0),
    ]);
    return new THREE.TubeGeometry(curve, 24, 0.045, 6, false);
  }, [height, lean]);
  const leafShape = useMemo(() => blobShape([[0, 0], [0.5, 0.15], [0.9, 0.0], [0.5, -0.2]]), []);
  return (
    <group position={base}>
      <mesh>
        <primitive object={tube} attach="geometry" />
        <meshBasicMaterial color={color} />
      </mesh>
      <Silhouette shape={leafShape} fill={leaf} outline={color} position={[lean * 0.6, height, 0.01]} rotation={0.4} scale={1.7} />
    </group>
  );
};

/** Beaded light string: dots along a sagging curve, additive. */
export const LightString: React.FC<{from: [number, number, number]; to: [number, number, number]; sag: number; beads: number; map: THREE.Texture; size: number}> = ({from, to, sag, beads, map, size}) => {
  const pts = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    return Array.from({length: beads}, (_, i) => {
      const t = i / (beads - 1);
      return a.clone().lerp(b, t).add(new THREE.Vector3(0, -sag * Math.sin(Math.PI * t), 0));
    });
  }, [from, to, sag, beads]);
  return (
    <>
      {pts.map((p, i) => (
        <sprite key={i} position={p} scale={[size * (i % 3 === 0 ? 1.6 : 1), size * (i % 3 === 0 ? 1.6 : 1), 1]}>
          <spriteMaterial map={map} blending={THREE.AdditiveBlending} depthWrite={false} transparent opacity={0.85} />
        </sprite>
      ))}
    </>
  );
};
