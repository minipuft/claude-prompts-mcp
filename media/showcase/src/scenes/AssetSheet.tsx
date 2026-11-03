import {AbsoluteFill} from 'remotion';
import type {ReactNode} from 'react';
import {identity, roleVars, settled} from '../library/tokens';

const skinVars = {'--skin': identity.humanSkin.main1, '--skin-shadow': identity.humanSkin.shadow, '--skin-light': identity.humanSkin.light} as React.CSSProperties;
import {fonts} from '../design';

export type SheetVariant = {id: string; title: string; borrows: string; between: string; node: ReactNode; silhouette?: ReactNode};

/**
 * Asset muse sheet (D55, rubric C19): 3+ variants of one asset rendered side by side in the substrate,
 * each labeled with the reference properties it borrows and the existing cast property it sits between.
 * One still per sheet; the owner picks from it; losers stay as controls.
 */
export const AssetSheet: React.FC<{asset: string; variants: SheetVariant[]; scale?: number}> = ({asset, variants, scale = 1}) => (
  <AbsoluteFill style={{background: settled.field}}>
    <div style={{position: 'absolute', left: 48, top: 36, fontFamily: fonts.sans, color: settled.kit.light, fontSize: 26, fontWeight: 600}}>Asset sheet · {asset}</div>
    <div style={{position: 'absolute', left: 48, right: 48, top: 90, display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start'}}>
      {variants.map((v) => (
        <div key={v.id} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', width: 360}}>
          <div style={{height: 380, display: 'flex', alignItems: 'flex-end', transform: `scale(${scale})`, transformOrigin: 'bottom center'}}>{v.node}</div>
          <div style={{marginTop: 18, fontFamily: fonts.sans, color: settled.kit.light, fontSize: 22, fontWeight: 600}}>{v.id} · {v.title}</div>
          <div style={{marginTop: 8, fontFamily: fonts.mono, color: settled.kit.main2, fontSize: 13, textAlign: 'center', lineHeight: 1.4}}>borrows: {v.borrows}</div>
          <div style={{marginTop: 4, fontFamily: fonts.mono, color: settled.gadget.light, fontSize: 13, textAlign: 'center', lineHeight: 1.4}}>between: {v.between}</div>
          {v.silhouette ? (
            <div style={{marginTop: 10, width: 120, height: 76, background: settled.human.light, position: 'relative', overflow: 'hidden'}}>
              {/* 64 px silhouette: the variant's own node with its roles bound, then brightness(0), so readability is judged before fills */}
              <div style={{position: 'absolute', left: 40, top: 6, transform: 'scale(0.194)', transformOrigin: 'top left', filter: 'brightness(0)', ...roleVars(settled.human, settled.outline), ...skinVars}}>{v.silhouette}</div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  </AbsoluteFill>
);
