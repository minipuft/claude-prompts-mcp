import {AbsoluteFill, Img, staticFile} from 'remotion';
import {fonts} from '../design';
import {settled} from '../library/tokens';

/** assets/<character>/model.json — the identity contract every key sheet is checked against (D72). */
export type ModelContract = {
  character: string;
  sheet: string; // path under public/, e.g. assets/human/model-01.png
  plateSha256: string;
  figureHeightPx: number;
  heads: number;
  views: {cell: number; view: string; heightPx: number; headPx: number; limbRatios: Record<string, number>}[];
  scaleAgreementPct: number; // max height drift between views, in percent of the tallest
  contour: {measuredPx: number; targetPx: number; tolerancePct: number; tapered: boolean; closed: boolean};
  expressions: string[];
  hands: string[];
  receipt: string; // generation receipt path
  provisional: boolean;
};

const Row: React.FC<{label: string; value: string; ok?: boolean}> = ({label, value, ok}) => (
  <div style={{display: 'flex', gap: 10, fontFamily: fonts.mono, fontSize: 13, lineHeight: 1.5}}>
    <span style={{color: settled.kit.main2, width: 150}}>{label}</span>
    <span style={{color: ok === false ? settled.gadget.accent : settled.kit.light}}>{value}</span>
  </div>
);

/**
 * Model sheet view (D72): the generated plate at full width with the measured contract beside it.
 * The sheet is provisional until the owner approves it from this still; nothing is cut here.
 */
export const ModelSheet: React.FC<{model: ModelContract}> = ({model}) => {
  const scaleOk = model.scaleAgreementPct <= 5;
  const contourOk = Math.abs(model.contour.measuredPx - model.contour.targetPx) <= (model.contour.targetPx * model.contour.tolerancePct) / 100;
  return (
    <AbsoluteFill style={{background: settled.field}}>
      <div style={{position: 'absolute', left: 40, top: 28, fontFamily: fonts.sans, color: settled.kit.light, fontSize: 24, fontWeight: 600}}>
        Model sheet · {model.character} {model.provisional ? '· provisional, owner approval pending' : '· approved'}
      </div>
      <div style={{position: 'absolute', left: 40, top: 76, width: 900, height: 600, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <Img src={staticFile(model.sheet)} style={{maxWidth: 900, maxHeight: 600, objectFit: 'contain'}} />
      </div>
      <div style={{position: 'absolute', left: 964, top: 80, width: 290, display: 'flex', flexDirection: 'column', gap: 4}}>
        <Row label="figure height" value={`${model.figureHeightPx} px · ${model.heads} heads`} />
        <Row label="scale agreement" value={`${model.scaleAgreementPct.toFixed(1)} % drift (≤ 5)`} ok={scaleOk} />
        <Row label="contour" value={`${model.contour.measuredPx.toFixed(1)} px (target ${model.contour.targetPx.toFixed(1)} ± ${model.contour.tolerancePct} %)`} ok={contourOk} />
        <Row label="taper · closed" value={`${model.contour.tapered ? 'yes' : 'no'} · ${model.contour.closed ? 'yes' : 'no'}`} ok={model.contour.tapered && model.contour.closed} />
        <div style={{height: 10}} />
        {model.views.map((v) => (
          <Row key={v.cell} label={`${v.cell} · ${v.view}`} value={`${v.heightPx} px · head ${v.headPx} px · ${Object.entries(v.limbRatios).map(([k, r]) => `${k} ${r.toFixed(2)}`).join(' · ')}`} />
        ))}
        <div style={{height: 10}} />
        <Row label="expressions" value={model.expressions.join(', ')} />
        <Row label="hands" value={model.hands.join(', ')} />
        <Row label="plate" value={model.plateSha256.slice(0, 16)} />
        <Row label="receipt" value={model.receipt} />
      </div>
    </AbsoluteFill>
  );
};
