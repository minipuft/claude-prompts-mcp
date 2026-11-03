import {interpolateColors} from 'remotion';

/** Five role slots per asset (owner board 2026-10-06, sticker-sheet recipe). */
export type Role = 'main1' | 'main2' | 'shadow' | 'light' | 'accent';
export type RoleMap = Record<Role, string>;

/** A palette state binds roles for each asset family plus field and emitter. Identity pigments never grade. */
export type Palette = {
  field: string;
  outline: string;
  emitter: string;
  /** emitter hue bands, core outward (cloaked-figure iridescence); identity pigments are never in here */
  bands: string[];
  human: RoleMap;
  kit: RoleMap;
  gadget: RoleMap;
};

/** Identity pigments: fixed across every state (creative-spec v4, palette law). */
export const identity = {
  codex: {main1: '#4f7df2', main2: '#2c49b8', shadow: '#1f2f7a', light: '#8fb1ff', accent: '#9fe8ff'},
  clawd: {main1: '#e8694a', main2: '#c94a2f', shadow: '#8c2f1c', light: '#ffa184', accent: '#2a1410'},
  /** D54: skin green between coral and blue; the shadow step is the mauve of the other route, which gives the stipple its hue shift. */
  humanSkin: {main1: '#67b479', main2: '#4f9a62', shadow: '#c885c2', light: '#9fd9a8', accent: '#1d1d36'},
} as const satisfies Record<string, RoleMap>;

/**
 * Resampled 2026-10-07 from the Seuss Midnight Paintings (owner ruling, D50): kit = night blues with cream contour and a red accent,
 * gadget = the nested-frames golds, human = Archbishop Katz mauves. Median-cut samples, then rounded by eye; provisional until a still is reviewed.
 */
export const settled: Palette = {
  field: '#07060c',
  outline: '#131818',
  emitter: '#ffe9b0',
  bands: ['#fff1c9', '#f2c56a', '#d28a21', '#56b0d4', '#0c6ca0'],
  /** D69: the human's garment is the Archbishop Katz family as generated in studies/human-gen-16: Katz blue, garment mauve (distinct from the skin's mauve shadow pigment), navy shadow, cream, gold accent. */
  human: {main1: '#2f45a8', main2: '#b983c0', shadow: '#1d1d36', light: '#e7e4da', accent: '#d28a21'},
  kit: {main1: '#0c6ca0', main2: '#56b0d4', shadow: '#142b3e', light: '#d9e5e3', accent: '#c8323a'},
  gadget: {main1: '#d28a21', main2: '#a45820', shadow: '#64341b', light: '#f2c56a', accent: '#56b0d4'},
};

export const overwhelm: Palette = {
  ...settled,
  field: '#0b0712',
  emitter: '#fff6d6',
  bands: ['#ffffff', '#f2c56a', '#c8323a', '#a37c9d', '#56b0d4', '#0c6ca0'],
  kit: {...settled.kit, accent: '#ff5a3c'},
  gadget: {...settled.gadget, light: '#fff1c9', accent: '#ff5a3c'},
};

export const scaffold: Palette = {...settled, emitter: '#ffd27a', bands: ['#fff1c9', '#d28a21', '#56b0d4', '#0c6ca0']};

const lerpRoles = (a: RoleMap, b: RoleMap, t: number): RoleMap => ({
  main1: interpolateColors(t, [0, 1], [a.main1, b.main1]),
  main2: interpolateColors(t, [0, 1], [a.main2, b.main2]),
  shadow: interpolateColors(t, [0, 1], [a.shadow, b.shadow]),
  light: interpolateColors(t, [0, 1], [a.light, b.light]),
  accent: interpolateColors(t, [0, 1], [a.accent, b.accent]),
});

/** Per-role interpolation between two states; identity pigments are not part of a Palette and never move. */
export const lerpPalette = (a: Palette, b: Palette, t: number): Palette => ({
  field: interpolateColors(t, [0, 1], [a.field, b.field]),
  outline: interpolateColors(t, [0, 1], [a.outline, b.outline]),
  emitter: interpolateColors(t, [0, 1], [a.emitter, b.emitter]),
  bands: Array.from({length: Math.max(a.bands.length, b.bands.length)}, (_, i) =>
    interpolateColors(t, [0, 1], [a.bands[Math.min(i, a.bands.length - 1)] ?? a.emitter, b.bands[Math.min(i, b.bands.length - 1)] ?? b.emitter]),
  ),
  human: lerpRoles(a.human, b.human, t),
  kit: lerpRoles(a.kit, b.kit, t),
  gadget: lerpRoles(a.gadget, b.gadget, t),
});

/** CSS custom properties for one role map; sprites read var(--main1) etc. */
export const roleVars = (roles: RoleMap, outline: string): React.CSSProperties =>
  ({'--main1': roles.main1, '--main2': roles.main2, '--shadow': roles.shadow, '--light': roles.light, '--accent': roles.accent, '--outline': outline} as React.CSSProperties);

/**
 * Shot s01 (D74 colour script): Turrell blue radiance #0a51fb and one accent #fad204. Every fill that is not an identity pigment sits inside that
 * pair (hue within 15 degrees of the radiance or of the accent, or too pale to read as a hue), so a palette change is the only edit the shot's props
 * need (C2, C24). Roles are bound per asset family like the settled palette; Codex and Clawd keep `identity`, the human's texture keeps its skin.
 */
export const s01Turrell = {
  radiance: '#0a51fb',
  accent: '#fad204',
  kit: {main1: '#1f4fe8', main2: '#5b86ff', shadow: '#0a2a9c', light: '#dbe6ff', accent: '#fad204'},
  gadget: {main1: '#2a5cf0', main2: '#0e3ccb', shadow: '#0b2370', light: '#e4ecff', accent: '#fad204'},
  box: {main1: '#101c52', main2: '#182a78', shadow: '#080d2c', light: '#33489a', accent: '#fad204'},
  outline: '#0b1030',
  /** The stipple's cool tint (DitherDefs `--cool`, D48: a hue shift toward cool at contact): bound to the pair's blue so the shadows add no third hue (C24). */
  cool: '#1d3bb0',
} as const satisfies {radiance: string; accent: string; kit: RoleMap; gadget: RoleMap; box: RoleMap; outline: string; cool: string};
