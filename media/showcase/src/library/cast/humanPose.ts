import skeletonFile from '../../../assets/human/skeleton.json';
import type {Joints, PoseChart} from '../motion';

/**
 * The human's joints and the lift poses, as data (D73). Joints are in mask.png pixel space, the space of assets/human/mesh.json
 * and assets/human/skeleton.json (the SSOT). A pose is a full set of joint positions; poseAt() in motion.ts steps through a chart of them.
 * Pure: no React, no DOM, so a measuring script can bundle this file and read the same poses the render uses.
 */
type SkeletonJoint = {name: string; loc: [number, number]; parent: string | null};
const joints = skeletonFile.skeleton as unknown as SkeletonJoint[];

export const jointNames: string[] = joints.map((j) => j.name);
/** child -> parent, for bone-wise pose blending. */
export const jointParents: Record<string, string> = Object.fromEntries(joints.filter((j) => j.parent).map((j) => [j.name, j.parent!]));
export const restPose: Joints = Object.fromEntries(joints.map((j) => [j.name, [j.loc[0], j.loc[1]] as [number, number]]));

const rad = (deg: number) => (deg * Math.PI) / 180;
const turn = (v: [number, number], deg: number): [number, number] => {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; // clockwise on screen for positive degrees, like CSS rotate()
};

/**
 * Both arms raised: the upper arm turns `lift * UPPER` degrees about the shoulder, the forearm `fore * FORE` more about the elbow, outward
 * arm first (left is image-left, so it turns clockwise, right counter-clockwise), like HumanPuppet's armX_up and armX_lo.
 * HumanPuppet's upper arm turns 150 degrees and its forearm 25 more. This figure's shoulders are 116 px apart (the puppet's are 242), so
 * the same angles would bring the hands together over the head; 105 and 5 end in a V: past that the single-mesh poncho is dragged into a column (see v3/studies/puppet-proof-03.md).
 */
const UPPER = 105;
const FORE = 5;
export const liftPose = (lift: number, fore: number): Joints => {
  const out: Joints = {...restPose};
  for (const [side, sign] of [['L', 1], ['R', -1]] as const) {
    const s = restPose[`shoulder${side}`]!, e = restPose[`elbow${side}`]!, w = restPose[`wrist${side}`]!;
    const up = turn([e[0] - s[0], e[1] - s[1]], sign * lift * UPPER);
    const elbow: [number, number] = [s[0] + up[0], s[1] + up[1]];
    const lo = turn([w[0] - e[0], w[1] - e[1]], sign * (lift * UPPER + fore * FORE));
    out[`elbow${side}`] = elbow;
    out[`wrist${side}`] = [elbow[0] + lo[0], elbow[1] + lo[1]];
  }
  return out;
};

/**
 * The 90-frame lift of PuppetProof as three keys at the frames `move()` hits them (liftAt 24, house phases): rest held until 24,
 * the raise with its 8% overshoot at 36, the settle at 50. 24 -> 36 gets the automatic thirds (28, 32); 36 -> 50 has one authored
 * breakdown at 44, two thirds of the way.
 */
export const liftChart: PoseChart = {
  keys: [
    {frame: 0, joints: liftPose(0, 0), hold: 24},
    {frame: 36, joints: liftPose(1.08, 1.0)},
    {frame: 50, joints: liftPose(1, 1)},
  ],
  breakdowns: [{frame: 44, favour: 2 / 3}],
};
