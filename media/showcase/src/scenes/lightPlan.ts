/**
 * The episode's hue wiring: which shot's D74 hue pair belongs to which beat. Pure data over v3/shots.json; both the animatic and
 * scripts/animation/compile-light.mjs read it, so the light contract and the fallback derivation cannot disagree about a beat's pair.
 */
import shotsFile from '../../v3/shots.json';
import {lerpHex, type LightPair} from '../library/animation/light';
import type {RoleMap} from '../library/tokens';

/**
 * The v2 ledger has beats the shot list does not name yet; those take the shot their ledger `effects.radiance` line names.
 */
export const LEDGER_SHOT: Record<string, string> = {
  'art-world': 's03-scaffold', // radiance: "warm, s03 amber (D74)"
  crossing: 's03-scaffold', // radiance off: the previous world's hue holds, so no colour changes inside the line world
  'programming-world': 's02-cant-build-frame', // radiance: "s02 accent as the world's hue"
  'home-settle': 's04-settle', // radiance: "Soup! coral (D74 s04)"
};
type Shot = {id: string; beat: string[]; hue: LightPair};
const shots = shotsFile.shots as unknown as Shot[];

export const hueOf = (beatId: string): LightPair => {
  const shot = shots.find((s) => s.beat.includes(beatId)) ?? shots.find((s) => s.id === LEDGER_SHOT[beatId]);
  if (!shot) throw new Error(`animatic: no shot hue for beat "${beatId}"`);
  return {radiance: shot.hue.radiance, accent: shot.hue.accent};
};

/**
 * The five roles a beat's placeholder props are filled with: ONE hue of the beat's D74 pair, the radiance, in five steps (its body, a darker side, a darker shadow, a paler contour and a paler accent).
 * A prop the light falls on then stays inside the pair (C24, C30) and the region the colour probe reads around the emitter has one hue in it: with the pair's accent on the box's tape and the bubble's
 * beads it read the radiance and the accent blended, 207 degrees against a pair of 222 and 50. The pair's accent is not used: a placeholder is not the film's colour script.
 */
export const pairRoles = (pair: LightPair): RoleMap => ({
  main1: pair.radiance,
  main2: lerpHex(pair.radiance, '#000000', 0.4),
  shadow: lerpHex(pair.radiance, '#000000', 0.7),
  light: lerpHex(pair.radiance, '#ffffff', 0.5),
  accent: lerpHex(pair.radiance, '#ffffff', 0.25),
});
