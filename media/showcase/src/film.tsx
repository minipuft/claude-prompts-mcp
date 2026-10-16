import {AbsoluteFill, Easing, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {fonts, palette as p} from './design';
import {SceneGraphic} from './graphics';
import {story} from './story';
import type {Scene} from './story';

function SceneFrame({scene, index}: {scene: Scene; index: number}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const time = frame / fps;
  const light = scene.kind === 'identity' || scene.kind === 'result';
  const foreground = light ? p.ink : p.paper;
  const start = interpolate(frame, [0, .7 * fps], [0, 1], {easing: Easing.out(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const end = interpolate(frame, [scene.durationInFrames - .35 * fps, scene.durationInFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const narrow = scene.kind === 'identity';
  return <AbsoluteFill style={{background: light ? p.paper : p.ink, color: foreground, fontFamily: fonts.sans}}>
    <div style={{position: 'absolute', top: 56, left: 120, display: 'flex', alignItems: 'center', gap: 22}}>
      <Img src={staticFile(light ? 'mark.svg' : 'mark-reversed.svg')} style={{width: 52, height: 40}}/>
      <span style={{fontSize: 24, fontWeight: 600, letterSpacing: .4}}>Claude Prompts</span>
    </div>
    <div style={{position: 'absolute', right: 120, top: 64, fontFamily: fonts.mono, fontSize: 21, color: light ? p.ink : p.muted}}>SILENT FILM / 0{index + 1}</div>
    <div style={{position: 'absolute', top: 178, left: 120, width: narrow ? 1070 : 1680, opacity: start * end, transform: `translateY(${(1 - start) * 42}px)`}}>
      <div style={{fontFamily: fonts.mono, fontSize: 25, letterSpacing: 3, color: light ? p.ink : p.route, marginBottom: 25}}>{scene.kicker.toUpperCase()}</div>
      <h1 style={{fontSize: narrow ? 108 : 116, lineHeight: 1.03, letterSpacing: -4, fontWeight: 600, maxWidth: narrow ? 1070 : 1640, margin: 0, whiteSpace: 'pre-line'}}>{scene.headline}</h1>
      <p style={{fontSize: 33, lineHeight: 1.4, maxWidth: narrow ? 1030 : 1490, marginTop: 27, marginBottom: 0, color: light ? p.ink : p.muted}}>{scene.body}</p>
    </div>
    <div style={{position: 'absolute', left: 120, top: 550, width: 1680, height: 390, opacity: start * end}}><SceneGraphic scene={scene} time={time}/></div>
    <div style={{position: 'absolute', left: 120, right: 120, bottom: 58, height: 2, background: light ? '#CDD5D1' : p.rule}}>
      <div style={{width: `${(index + 1) / story.scenes.length * 100}%`, height: 2, background: p.route}}/>
      {story.scenes.map((item, i) => <span key={item.id} style={{position: 'absolute', left: `${i / story.scenes.length * 100}%`, top: -4, width: 10, height: 10, background: i === index ? p.gate : light ? p.ink : p.rule}}/>)}
    </div>
    <div style={{position: 'absolute', left: 120, bottom: 22, fontFamily: fonts.mono, fontSize: 19, color: light ? p.ink : p.muted}}>EDITORIAL ANIMATION · SPECULATIVE DRAFT</div>
    <div style={{position: 'absolute', right: 120, bottom: 22, fontFamily: fonts.mono, fontSize: 19, color: light ? p.ink : p.muted}}>CLIENT EXECUTES / SERVER GUIDES</div>
  </AbsoluteFill>;
}

export const ShowcaseFilm = () => <AbsoluteFill style={{background: p.ink}}>
  {story.scenes.map((scene, index) => <Sequence key={scene.id} from={scene.startFrame} durationInFrames={scene.durationInFrames} premountFor={story.fps}>
    <SceneFrame scene={scene} index={index}/>
  </Sequence>)}
</AbsoluteFill>;
