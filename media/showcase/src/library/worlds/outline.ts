import {Vector2, type BufferGeometry} from 'three';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';

/**
 * The figure's silhouette as a stroke: the mesh's boundary edges (those used by exactly one triangle) drawn as screen-space fat lines.
 * The boundary is one closed loop per outline of the mesh, so the contour is connected by construction; the alpha band the fragment
 * program can find leaves gaps where the simplified mesh polygon cuts a narrow crotch (between fingers). Topology is fixed, so the edge
 * list is built once; positions are copied from the solved geometry by `update`, which the solver calls right after it writes (a draw-time copy would
 * be uploaded a frame late: three uploads attributes while it builds the render list, before `onBeforeRender`).
 */
export const boundaryEdges = (geometry: BufferGeometry): Uint32Array => {
  const index = geometry.getIndex();
  if (!index) throw new Error('boundaryEdges: the figure geometry has no index');
  const count = new Map<number, number>();
  const n = geometry.getAttribute('position').count;
  const key = (a: number, b: number) => Math.min(a, b) * n + Math.max(a, b);
  for (let t = 0; t < index.count; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = index.getX(t + k), b = index.getX(t + ((k + 1) % 3));
      count.set(key(a, b), (count.get(key(a, b)) ?? 0) + 1);
    }
  }
  const out: number[] = [];
  for (const [e, c] of count) if (c === 1) out.push(Math.floor(e / n), e % n);
  return Uint32Array.from(out);
};

/** Callbacks a geometry's solver runs right after it writes new positions (MeshFigure's useFigureGeometry); consumers register in `userData.onSolved`. */
export type SolvedListeners = Set<() => void>;

export const makeOutline = (geometry: BufferGeometry, resolution: [number, number]): {lines: LineSegments2; update: () => void} => {
  const edges = boundaryEdges(geometry);
  const segments = edges.length / 2;
  const lines = new LineSegments2(new LineSegmentsGeometry().setPositions(new Float32Array(segments * 6)), new LineMaterial({toneMapped: false, transparent: true, depthWrite: false, resolution: new Vector2(...resolution)}));
  lines.frustumCulled = false;
  lines.renderOrder = 2;
  const update = () => {
    const position = geometry.getAttribute('position').array as Float32Array;
    const buffer = (lines.geometry.attributes.instanceStart as unknown as {data: {array: Float32Array; needsUpdate: boolean}}).data;
    for (let s = 0; s < segments; s++) {
      for (let end = 0; end < 2; end++) {
        const v = edges[2 * s + end]!;
        for (let c = 0; c < 3; c++) buffer.array[6 * s + 3 * end + c] = position[3 * v + c]!;
      }
    }
    buffer.needsUpdate = true;
  };
  return {lines, update};
};
