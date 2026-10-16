/**
 * The episode's hue wiring: which shot's D74 hue pair belongs to which beat. Pure data over v3/shots.json; both the animatic and
 * scripts/animation/compile-light.mjs read it, so the light contract and the fallback derivation cannot disagree about a beat's pair.
 */
import shotsFile from '../../v3/shots.json';
import type {LightPair} from '../library/animation/light';

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
