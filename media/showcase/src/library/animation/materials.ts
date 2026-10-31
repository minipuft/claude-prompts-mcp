/**
 * The material contract (D97): what each thing in the film is made of, as numbers. `v3/materials.json` is the file; `v3/materials.schema.json` owns the ranges, `scripts/animation/probe-materials.py`
 * reads them (and the cross-rules: a transmissive declares refraction, an emissive has albedo 1, cloth stiffness below 0.3, a lag declares a settle) and `npm run typecheck` runs that probe
 * first, because a JSON import widens every number to `number` and every word to `string`: this file's `satisfies` sees a missing material, a missing property or a wrong kind of value, and
 * only the probe sees an out-of-range one. The secondaries solver (`secondaries.ts`) reads the motion properties; the light layer reads `occluder`, `albedo`, `shadowClass`, `refraction`, `diffusion`.
 */
import materialsJson from '../../../v3/materials.json';

/** The word a value is for: how it should read on screen. */
export const INTENTS = ['snap', 'float', 'weighted', 'drape', 'crisp', 'soft', 'still'] as const;
export type Intent = (typeof INTENTS)[number];
export const SHADOW_CLASSES = ['none', 'stipple-1', 'stipple-2', 'stipple-3'] as const;
export type ShadowClass = (typeof SHADOW_CLASSES)[number];
export const OCCLUDERS = ['solid', 'transmissive', 'emissive'] as const;
export type Occluder = (typeof OCCLUDERS)[number];

/** A declared value, the word it is for (one of `INTENTS`) and the board card (`v3/references/board.json`) that shows it, or null. */
export type Rated<T> = {value: T; intent: string; ref: string | null};

export type Material = {
  /** Gravity scale and swing: above 0 up to 4 (cloak 1, box 2). Null where the material does not move. */
  mass: Rated<number> | null;
  /** Frames the secondary trails its primary, a floor the solver must clear: whole frames 0 to 12. */
  lagFrames: Rated<number> | null;
  /** Frames after the primary stops during which the secondary still moves: whole frames 1 to 30. */
  settleFrames: Rated<number> | null;
  /** First return past rest as a fraction of the move: 0 to 0.5. */
  overshoot: Rated<number> | null;
  /** Air resistance, velocity lost per frame: 0 to 1. */
  drag: Rated<number> | null;
  /** Share of the gravity load the drawn shape holds: 0 to 1 (cloth below 0.3, hair above 0). */
  stiffness: Rated<number> | null;
  /** Frames of the settle breakdown after a contact key: whole frames 1 to 12. */
  contact: Rated<number> | null;
  /** Line wobble amplitude, 1 the house line: 0 to 3. */
  boil: Rated<number>;
  /** One of `SHADOW_CLASSES` (JSON widens it to `string`; the probe checks the word). */
  shadowClass: Rated<string>;
  /** One of `OCCLUDERS` (the probe checks the word). */
  occluder: Rated<string>;
  /** Hue a lit edge gives back: 0 to 1; an emissive material is 1. */
  albedo: Rated<number>;
  /** Displacement of what is behind: above 0 up to 1, declared by every transmissive material and no other. */
  refraction: Rated<number> | null;
  /** Softening of what is behind: 0 to 1, declared with refraction. */
  diffusion: Rated<number> | null;
};

export type MaterialId = 'cloth' | 'hair' | 'body' | 'box' | 'glass' | 'light' | 'paper' | 'line';

const materials = materialsJson satisfies Record<MaterialId, Material>;

export const MATERIAL_IDS = Object.keys(materials) as MaterialId[];

export const materialOf = (id: MaterialId): Material => {
  const material = materials[id];
  if (!material) throw new Error(`materialOf: there is no material "${id}"; the file declares ${MATERIAL_IDS.join(', ')}`);
  return material;
};

/** The numbers a secondary is solved from: every motion property of a material, plain. A material that declares no lag or settle does not move as a secondary: null. */
export type Motion = {mass: number; lagFrames: number; settleFrames: number; overshoot: number; drag: number; stiffness: number; contact: number | null};

export const motionOf = (material: Material): Motion | null => {
  if (material.lagFrames === null || material.settleFrames === null) return null;
  return {
    mass: material.mass?.value ?? 0,
    lagFrames: material.lagFrames.value,
    settleFrames: material.settleFrames.value,
    overshoot: material.overshoot?.value ?? 0,
    drag: material.drag?.value ?? 0,
    stiffness: material.stiffness?.value ?? 0,
    contact: material.contact?.value ?? null,
  };
};
