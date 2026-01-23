import { interpolate, spring } from "remotion";
import { durations, springs } from "../constants";

type FadeOptions = {
  start?: number;
  duration?: number;
};

type SlideOptions = FadeOptions & {
  from?: number;
  to?: number;
};

export const fadeIn = (
  frame: number,
  { start = 0, duration = durations.normal }: FadeOptions = {}
) => {
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
};

export const slideUp = (
  frame: number,
  { start = 0, duration = durations.normal, from = 24, to = 0 }: SlideOptions = {}
) => {
  return interpolate(frame, [start, start + duration], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
};

export const scaleIn = (
  frame: number,
  fps: number,
  { start = 0, duration = durations.normal }: FadeOptions = {}
) => {
  return spring({
    frame: frame - start,
    fps,
    durationInFrames: duration,
    config: springs.soft,
  });
};

export const staggerDelay = (index: number, base = durations.fast) => {
  return index * base;
};
