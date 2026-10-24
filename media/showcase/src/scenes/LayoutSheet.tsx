import {AbsoluteFill, Img, staticFile} from 'remotion';
import {fonts} from '../design';
import {settled} from '../library/tokens';

/** v3/layouts/<shot>.json — the cinematography contract of a shot (D77); the key sheet is drawn at this camera. */
export type LayoutContract = {
  shot: string;
  sheet: string; // path under public/, e.g. assets/layouts/s02-layout-01.png
  sheetSha256: string;
  camera: {start: string; end: string; move: string; ledBy: string};
  hue: {radiance: string; accent: string};
  emitter: {start: string; end: string; startXY?: number[]; endXY?: number[]};
  figure: {actor: string; startHeightPct: number | null; endHeightPct: number | null; heads: number; note?: string};
  /** The move as numbers (stage pixels at the film's frame size), when the layout carries them: `cameraFromLayout` reads it. */
  cameraPose?: {span?: number[]; start: {x?: number; y?: number; zoom?: number}; end: {x?: number; y?: number; zoom?: number}};
  panels: {n: number; what: string}[];
  cards: string[];
  receipt: string;
  provisional: boolean;
};

const Row: React.FC<{label: string; value: string}> = ({label, value}) => (
  <div style={{display: 'flex', gap: 10, fontFamily: fonts.mono, fontSize: 13, lineHeight: 1.45}}>
    <span style={{color: settled.kit.main2, width: 120, flexShrink: 0}}>{label}</span>
    <span style={{color: settled.kit.light}}>{value}</span>
  </div>
);

/** Cinematography sheet view: the generated four-panel sheet with the contract it carries, and the shot's hue pair as swatches. */
export const LayoutSheet: React.FC<{layout: LayoutContract}> = ({layout}) => (
  <AbsoluteFill style={{background: settled.field}}>
    <div style={{position: 'absolute', left: 40, top: 28, fontFamily: fonts.sans, color: settled.kit.light, fontSize: 24, fontWeight: 600}}>
      Cinematography sheet · {layout.shot} {layout.provisional ? '· provisional, owner approval pending' : '· approved'}
    </div>
    <div style={{position: 'absolute', left: 40, top: 76, width: 880, height: 600, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
      <Img src={staticFile(layout.sheet)} style={{maxWidth: 880, maxHeight: 600, objectFit: 'contain'}} />
    </div>
    <div style={{position: 'absolute', left: 944, top: 80, width: 310, display: 'flex', flexDirection: 'column', gap: 4}}>
      <div style={{display: 'flex', gap: 8, marginBottom: 6}}>
        <div style={{width: 60, height: 28, background: layout.hue.radiance, border: `1px solid ${settled.kit.main2}`}} />
        <div style={{width: 60, height: 28, background: layout.hue.accent}} />
        <span style={{fontFamily: fonts.mono, fontSize: 12, color: settled.kit.main2, alignSelf: 'center'}}>{layout.hue.radiance} · {layout.hue.accent} (D74)</span>
      </div>
      <Row label="camera start" value={layout.camera.start} />
      <Row label="camera end" value={layout.camera.end} />
      <Row label="move" value={`${layout.camera.move} · led by ${layout.camera.ledBy}`} />
      <Row label="emitter" value={`${layout.emitter.start} → ${layout.emitter.end}`} />
      <Row label="figure" value={`${layout.figure.actor}: ${layout.figure.startHeightPct ?? '?'} % → ${layout.figure.endHeightPct ?? 'merged with the frame, unmeasured'} % of frame height · ${layout.figure.heads} heads`} />
      {layout.cameraPose && (
        <Row
          label="camera"
          value={`(${layout.cameraPose.start.x}, ${layout.cameraPose.start.y}) x${layout.cameraPose.start.zoom} → (${layout.cameraPose.end.x}, ${layout.cameraPose.end.y}) x${layout.cameraPose.end.zoom}${layout.cameraPose.span ? ` over frames ${layout.cameraPose.span[0]}-${layout.cameraPose.span[1]}` : ''}`}
        />
      )}
      <div style={{height: 8}} />
      {layout.panels.map((p) => (
        <Row key={p.n} label={`panel ${p.n}`} value={p.what} />
      ))}
      <div style={{height: 8}} />
      <Row label="cards" value={layout.cards.join(' · ')} />
      <Row label="receipt" value={layout.receipt} />
    </div>
  </AbsoluteFill>
);
