import skeletonFile from '../../../assets/human/skeleton.json';

/**
 * Where the figure's mask space (the pixels of assets/human/mask.png: the home mesh, the skeleton, every part of the parts rig) lands in HumanPuppet's canvas space (skeleton.json
 * `registration`: canvas = scale * (p - originMask) + originCanvas, y down). MeshFigure and the parts rig (PartsFigure) place the figure with the same numbers.
 */
type Registration = {originMask: [number, number]; scale: number; originCanvas: [number, number]; canvas: [number, number]};
export const registration = skeletonFile.registration as unknown as Registration;
export const [canvasW, canvasH] = registration.canvas;
/** Canvas pixels above the figure's top that the ThreeCanvas also covers: a raised hand leaves the figure's box, and HumanPuppet's divs do not clip. */
export const PAD_TOP = 350;
/** Canvas pixels left and right of the figure's rest box that the ThreeCanvas also covers: a pose that throws an arm wider than the rest figure (the open and star keys) is drawn whole, not cut at the canvas edge. */
export const PAD_SIDE = 300;
/** A mask-space point in HumanPuppet canvas space (y down). */
export const maskToCanvas = ([x, y]: [number, number]): [number, number] => [
  registration.scale * (x - registration.originMask[0]) + registration.originCanvas[0],
  registration.scale * (y - registration.originMask[1]) + registration.originCanvas[1],
];
/** Mask-space vertices (interleaved x, y) -> three.js world units, which are HumanPuppet canvas pixels with y pointing up (z = 0): the geometry `out` of 3 floats per vertex. */
export const maskToWorld = (solved: ArrayLike<number>, out: Float32Array): void => {
  const {scale, originMask: [mx, my], originCanvas: [cx, cy]} = registration;
  const n = solved.length / 2;
  for (let i = 0; i < n; i++) {
    out[3 * i] = scale * (solved[2 * i]! - mx) + cx;
    out[3 * i + 1] = -(scale * (solved[2 * i + 1]! - my) + cy);
    out[3 * i + 2] = 0;
  }
};
