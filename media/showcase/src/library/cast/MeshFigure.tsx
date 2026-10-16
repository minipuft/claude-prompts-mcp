import {useLayoutEffect, useMemo, type ReactNode} from 'react';
import {staticFile} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import {useLoader} from '@react-three/fiber';
import {BufferAttribute, BufferGeometry, DoubleSide, SRGBColorSpace, TextureLoader, type Texture} from 'three';
import meshFile from '../../../assets/human/mesh.json';
import {Arap} from '../motion/arap';
import type {Joints} from '../motion';
import type {PartName} from '../motion/partsRig';
import {jointNames, restPose} from './humanPose';
import {PAD_SIDE, PAD_TOP, canvasH, canvasW, maskToCanvas, maskToWorld, registration} from './figureSpace';
import {PartsMesh} from './PartsFigure';

export {PAD_SIDE, PAD_TOP, canvasH, canvasW, maskToCanvas};

/**
 * The human as a deformed triangle mesh (D73), replacing HumanPuppet's rotation-only cutouts. assets/human/mesh.json is the figure's
 * silhouette triangulated at build time (scripts/mesh.mjs); every frame the ARAP solver (motion/arap.ts) moves the vertices so the
 * skeleton's joints land on the posed joint positions, and the figure's own PNG (assets/human/cutout.png) is the texture, so the
 * limbs bend instead of rotating about a pivot and no joint can open.
 *
 * `pose` is joint positions in mask.png pixel space (humanPose.ts has the rest pose and the lift; motion.ts poseAt steps a chart).
 * `order` (front first) draws the figure as the parts rig instead (PartsFigure.tsx, row 6.9): every part its own ARAP mesh, drawn in that order; a world's own `mesh` renderer ignores it.
 * `scale`, `x`, `y` mean what they mean on HumanPuppet: the figure is placed in HumanPuppet's canvas space (skeleton.json `registration`
 * maps mask space into it) and that canvas is scaled by `scale` with its top-left at (x, y).
 */
const vertexCount = meshFile.vertices.length / 2;
/** The figure's height in HumanPuppet canvas pixels (rest mesh extent); multiply by `scale` for screen pixels. World contracts size their contour from it. */
export const figureCanvasHeight = (() => {
  const ys = meshFile.vertices.filter((_, i) => i % 2 === 1);
  return registration.scale * (Math.max(...ys) - Math.min(...ys));
})();
const restVertices = Float32Array.from(meshFile.vertices);

/** One solver per process: factoring the two normal matrices is the only expensive step (about 0.1 s at 418 vertices). */
let solver: Arap | null = null;
const getSolver = (): Arap => {
  solver ??= new Arap({vertices: restVertices, triangles: Uint32Array.from(meshFile.triangles)}, pinsOf(restPose));
  return solver;
};
const pinsOf = (joints: Joints): Float32Array => Float32Array.from(jointNames.flatMap((n) => joints[n] ?? restPose[n]!));

/** The figure's texture, set up the way every renderer of the mesh needs it (unflipped, sRGB). */
export const useFigureTexture = (): Texture => {
  const texture = useLoader(TextureLoader, staticFile('assets/human/cutout.png'));
  useMemo(() => { texture.flipY = false; texture.colorSpace = SRGBColorSpace; texture.needsUpdate = true; }, [texture]);
  return texture;
};

/** The deformed figure geometry for `pose`, in HumanPuppet canvas pixels (y up, y = 0 at the canvas top). Re-solved every render. */
export const useFigureGeometry = (pose: Joints): BufferGeometry => {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const position = new Float32Array(3 * vertexCount);
    maskToWorld(restVertices, position);
    g.setAttribute('position', new BufferAttribute(position, 3));
    g.setAttribute('uv', new BufferAttribute(Float32Array.from(meshFile.uvs), 2));
    g.setIndex(new BufferAttribute(Uint32Array.from(meshFile.triangles), 1));
    return g;
  }, []);
  // layout effects run before ThreeCanvas advances the frame, so the render sees this frame's positions
  useLayoutEffect(() => {
    const position = geometry.getAttribute('position') as BufferAttribute;
    maskToWorld(getSolver().solve(pinsOf(pose)), position.array as Float32Array);
    position.needsUpdate = true;
    // renderers that copy the solved positions (a stroke along the boundary) register here; child layout effects ran first, so they are set
    (geometry.userData.onSolved as Set<() => void> | undefined)?.forEach((notify) => notify());
  });
  return geometry;
};

/** What a world's mesh renderer receives: the shared geometry and texture. */
export type FigureParts = {geometry: BufferGeometry; texture: Texture};

const FigureMesh: React.FC<{pose: Joints; wireframe: boolean; mesh?: (parts: FigureParts) => ReactNode}> = ({pose, wireframe, mesh}) => {
  const texture = useFigureTexture();
  const geometry = useFigureGeometry(pose);
  if (mesh) return <>{mesh({geometry, texture})}</>;
  return (
    <mesh geometry={geometry} frustumCulled={false}>
      <meshBasicMaterial map={texture} transparent alphaTest={0.05} side={DoubleSide} toneMapped={false} wireframe={wireframe} />
    </mesh>
  );
};

/** `mesh` replaces the default textured mesh with a world's own renderer over the same geometry (src/library/worlds). */
export const MeshFigure: React.FC<{pose?: Joints; scale?: number; x?: number; y?: number; wireframe?: boolean; mesh?: (parts: FigureParts) => ReactNode; order?: readonly PartName[]}> = ({pose = restPose, scale = 0.42, x = 0, y = 0, wireframe = false, mesh, order}) => (
  <ThreeCanvas
    orthographic
    width={Math.round((canvasW + 2 * PAD_SIDE) * scale)}
    height={Math.round((canvasH + PAD_TOP) * scale)}
    style={{position: 'absolute', left: x - PAD_SIDE * scale, top: y - PAD_TOP * scale}}
    camera={{left: -PAD_SIDE, right: canvasW + PAD_SIDE, top: PAD_TOP, bottom: -canvasH, near: 0.1, far: 100, position: [0, 0, 10]}}
  >
    {order && !mesh ? <PartsMesh pose={pose} order={order} /> : <FigureMesh pose={pose} wireframe={wireframe} mesh={mesh} />}
  </ThreeCanvas>
);
