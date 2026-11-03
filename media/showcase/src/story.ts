import input from '../story.json';

export type SceneKind = 'problem' | 'identity' | 'compose' | 'request' | 'agents' | 'check' | 'result' | 'cta';
export type Scene = {
  id: string;
  startFrame: number;
  durationInFrames: number;
  kicker: string;
  headline: string;
  body: string;
  kind: SceneKind;
  code?: string;
  labels?: string[];
};
export type Story = {
  title: string;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  scenes: Scene[];
};
const kinds = new Set<unknown>(['problem', 'identity', 'compose', 'request', 'agents', 'check', 'result', 'cta']);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;
const text = (value: unknown): value is string => typeof value === 'string';
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const isScene = (value: unknown): value is Scene => record(value)
  && ['id', 'kicker', 'headline', 'body'].every((key) => text(value[key]))
  && typeof value.startFrame === 'number' && Number.isInteger(value.startFrame) && value.startFrame >= 0
  && positiveInteger(value.durationInFrames) && kinds.has(value.kind)
  && (value.code === undefined || text(value.code))
  && (value.labels === undefined || stringList(value.labels));

function readStory(value: unknown): Story {
  if (!record(value) || !text(value.title)
    || !positiveInteger(value.fps) || !positiveInteger(value.width) || !positiveInteger(value.height)
    || !positiveInteger(value.durationInFrames) || !Array.isArray(value.scenes) || !value.scenes.every(isScene)) {
    throw new Error('story.json does not match the declared showcase scene contract.');
  }
  let cursor = 0;
  const ids = new Set<string>();
  for (const scene of value.scenes) {
    if (scene.startFrame !== cursor || ids.has(scene.id)) throw new Error(`Scene ${scene.id}: gap, overlap, or duplicate ID.`);
    cursor += scene.durationInFrames;
    ids.add(scene.id);
  }
  if (cursor !== value.durationInFrames) throw new Error('Scene durations do not cover the declared film duration.');
  return {title: value.title, fps: value.fps, width: value.width, height: value.height, durationInFrames: value.durationInFrames, scenes: value.scenes};
}
export const story = readStory(input);
