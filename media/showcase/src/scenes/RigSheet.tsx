import {AbsoluteFill, Img, staticFile} from 'remotion';
import {settled} from '../library/tokens';
import {fonts} from '../design';
import {HumanPuppet, type FaceState, type PartRender} from '../library/cast/HumanPuppet';

/**
 * Rig sheet: the editing view for a puppet. Left: the rig at rest with every pivot (red), part id and part box (dashed) so a rig.json
 * edit is judged by eye. Middle: the three part renderings of D71 side by side (hard cut · soft alpha + contour · vector + contour) at
 * rest, with the head enlarged under each. Right: a pose strip through the lift, and the four face states at 1:1 and at film scale
 * (head ≈ 40 px), the D70 identity pass. A rig is edited against this sheet, never against a shot render alone.
 */
const strip = [0, 28, 32, 36, 44, 60];
const faces: FaceState[] = ['neutral', 'blink', 'mouth', 'look'];
const renders: Array<{id: PartRender; label: string}> = [
  {id: 'hard', label: 'hard cut'},
  {id: 'soft', label: 'soft α + contour'},
  {id: 'vector', label: 'vector + contour'},
];
const Label: React.FC<{x: number; y: number; text: string}> = ({x, y, text}) => (
  <div style={{position: 'absolute', left: x, top: y, color: settled.kit.main2, fontSize: 13, fontFamily: fonts.mono}}>{text}</div>
);
/** A window onto the puppet's head region at a chosen magnification (the head sits near canvas (300..400, 52..160)). */
const HeadZoom: React.FC<{x: number; y: number; render: PartRender; mag: number}> = ({x, y, render, mag}) => (
  <div style={{position: 'absolute', left: x, top: y, width: 150 * mag, height: 130 * mag, overflow: 'hidden', outline: `1px solid ${settled.kit.shadow}`}}>
    <HumanPuppet frame={0} scale={mag} x={-285 * mag} y={-40 * mag} render={render} />
  </div>
);
export const RigSheet: React.FC = () => (
  <AbsoluteFill style={{background: settled.field, fontFamily: fonts.sans}}>
    <div style={{position: 'absolute', left: 40, top: 22, color: settled.kit.light, fontSize: 22, fontWeight: 600}}>Rig sheet · human (Swoop) · assets/human/rig.json · face row 2 · D71 renderings</div>
    <HumanPuppet frame={0} scale={0.62} x={40} y={64} render="soft" debug />
    <Label x={440} y={64} text="D71 part rendering at rest · same rig, same parts" />
    {renders.map((r, i) => (
      <div key={r.id}>
        <HumanPuppet frame={0} scale={0.34} x={440 + i * 140} y={84} render={r.id} />
        <Label x={440 + i * 140} y={420} text={r.label} />
        <HeadZoom x={440 + i * 140} y={440} render={r.id} mag={0.85} />
      </div>
    ))}
    <Label x={900} y={64} text="lift on twos · 0 · 28 · 32 · 36 · 44 · 60" />
    {strip.map((f, i) => <HumanPuppet key={f} frame={f} scale={0.16} x={900 + i * 56} y={110} render="soft" />)}
    <Label x={900} y={290} text="face states 1:1 · identity pass at ≈ 40 px" />
    {faces.map((fc, i) => (
      <div key={fc} style={{position: 'absolute', left: 900 + i * 92, top: 312}}>
        <Img src={staticFile(`assets/human/face/${fc}-contour.png`)} style={{position: 'absolute', width: 84}} />
        <Img src={staticFile(`assets/human/face/${fc}.png`)} style={{position: 'absolute', width: 84}} />
        <div style={{position: 'absolute', top: 96, color: settled.gadget.light, fontSize: 12, fontFamily: fonts.mono}}>{fc}</div>
      </div>
    ))}
    {faces.map((fc, i) => (
      <Img key={fc + 's'} src={staticFile(`assets/human/face/${fc}.png`)} style={{position: 'absolute', left: 900 + i * 54, top: 440, height: 40}} />
    ))}
    <Label x={900} y={486} text="≈ 40 px" />
    <Label x={900} y={520} text="soft = blurred alpha σ≈1.1 · contour = pale halo ~5 px one step behind · vector = VTracer spline" />
  </AbsoluteFill>
);
