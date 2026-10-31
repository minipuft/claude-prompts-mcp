import {Img, interpolate, staticFile} from 'remotion';
import {fonts, palette as p} from './design';
import type {Scene} from './story';

type GraphicProps = {scene: Scene; time: number};
const amount = (time: number, start: number, end: number) => interpolate(time, [start, end], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
const mono = {fontFamily: fonts.mono, fontSize: 29};

export const Fragments = ({scene, time}: GraphicProps) => {
  const merge = amount(time, .65, 2);
  const reveal = amount(time, 1.65, 2.2);
  return <svg width="1680" height="380" viewBox="0 0 1680 380">
    {(scene.labels ?? ['Research', 'Review', 'Create']).slice(0, 3).map((text, i) => <g key={text} transform={`translate(${i * 560 * (1 - merge) + (400 + i * 16) * merge},${i * 12 * merge})`}>
      <rect x="0" y="50" width={500 + merge * 330} height="235" fill={p.ink} stroke={merge > .99 ? p.route : p.rule} strokeWidth="2"/>
      <g opacity={1 - reveal}><text x="25" y="135" fill={p.paper} style={{fontFamily: fonts.sans, fontSize: 38}}>{text}</text>
        <text x="25" y="220" fill={p.muted} style={mono}>instructions / repeated</text></g>
    </g>)}
    <g opacity={reveal}><text x="460" y="149" fill={p.paper} style={{fontFamily: fonts.sans, fontSize: 46}}>One reusable workflow.</text>
      <text x="460" y="232" fill={p.muted} style={mono}>reuse / adapt / create</text></g>
  </svg>;
};

export const Primitives = ({scene, time}: GraphicProps) => {
  const labels = scene.labels ?? ['Prompts', 'Chains', 'Checks', 'Skills export'];
  return <div style={{display: 'flex', gap: 42, alignItems: 'flex-start'}}>
    {labels.slice(0, 4).map((label, i) => {
      const progress = amount(time, i * .35, .9 + i * .35);
      return <div key={label} style={{width: 387, opacity: progress, transform: `translateY(${(1 - progress) * 45}px)`}}>
        <div style={{fontFamily: fonts.mono, fontSize: 94, color: i === 2 ? p.gate : p.route, lineHeight: 1.2}}>{['>>', '-->', '::', '==>'][i]}</div>
        <div style={{height: 2, background: p.rule, margin: '28px 0'}}/>
        <div style={{fontSize: 33, lineHeight: 1.28}}>{label.replace(/^[>:\-#=]+\s*/, '')}</div>
      </div>;
    })}
  </div>;
};

export const Request = ({scene, time}: GraphicProps) => <div style={{position: 'relative', height: 370}}>
  <div style={{borderLeft: `6px solid ${p.route}`, padding: '30px 0 30px 42px', fontFamily: fonts.mono, fontSize: 34, lineHeight: 1.7, whiteSpace: 'pre-wrap', maxWidth: 1580}}>
    {scene.code}
  </div>
  <div style={{position: 'absolute', bottom: 20, display: 'flex', gap: 24, opacity: amount(time, 1.5, 2.2)}}>
    {(scene.labels ?? ['Audience', 'Goals', 'Constraints']).map((label) => <span key={label} style={{border: `1px solid ${p.rule}`, padding: '15px 28px', fontSize: 28, color: p.muted}}>{label}</span>)}
  </div>
</div>;

export const AgentRoutes = ({scene, time}: GraphicProps) => {
  const labels = scene.labels ?? ['Script / narrative', 'Color / pacing', 'Motion / rendering'];
  return <svg width="1680" height="390" viewBox="0 0 1680 390">
    <path d="M10 56H1630" fill="none" stroke={p.rule} strokeWidth="2"/>
    <path d="M10 56H1630" fill="none" stroke={p.route} strokeWidth="4" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - amount(time, .5, 1.4)}/>
    <text x="0" y="30" fill={p.muted} style={{...mono, fontSize: 23}}>SHARED BRIEF / audience + goals + constraints</text>
    {labels.slice(0, 3).map((label, i) => {
      const x = i * 570;
      const progress = amount(time, .7 + i * 4, 1.7 + i * 4);
      const transfer = amount(time, 3 + i * 4, 4 + i * 4);
      return <g key={label}>
        <path d={`M${x + 250} 56V110`} stroke={p.rule} strokeWidth="2"/>
        <g opacity={progress} transform={`translate(0,${(1 - progress) * 22})`}>
          <rect x={x} y="110" width="500" height="250" fill="none" stroke={p.rule} strokeWidth="2"/>
          <text x={x + 30} y="160" fill={p.route} style={{...mono, fontSize: 24}}>{`0${i + 1} / CLIENT AGENT`}</text>
          <text x={x + 30} y="217" fill={p.paper} style={{fontFamily: fonts.sans, fontSize: 38}}>{label}</text>
          <path d={`M${x + 30} 250H${x + 465}`} stroke={p.rule}/>
          <text x={x + 30} y="304" fill={p.muted} style={{...mono, fontSize: 25}}>{['references →', 'scene plan →', 'motion plan →'][i]}</text>
        </g>
        {i < 2 ? <g opacity={transfer}>
          <path d={`M${x + 500} 235H${x + 570}`} stroke={p.route} strokeWidth="3"/>
          <rect x={x + 488 + transfer * 72} y="218" width="24" height="32" fill={p.paper}/>
        </g> : null}
      </g>;
    })}
  </svg>;
};

export const Checkpoint = ({scene, time}: GraphicProps) => <div style={{display: 'grid', gridTemplateColumns: '470px 1fr', gap: 100, alignItems: 'start'}}>
  <div style={{borderTop: `5px solid ${p.gate}`, paddingTop: 25}}>
    <div style={{fontFamily: fonts.mono, color: p.gate, fontSize: 88, lineHeight: 1}}>::</div>
    <div style={{fontSize: 42, lineHeight: 1.2, marginTop: 25}}>Authored<br/>criteria.</div>
    <div style={{fontFamily: fonts.mono, color: p.muted, fontSize: 23, marginTop: 27}}>criteria / illustration</div>
  </div>
  <div>{scene.body.split('.').map((label) => label.trim()).filter(Boolean).slice(0, 3).map((label, i) => <div key={label} style={{display: 'flex', alignItems: 'center', gap: 28, borderBottom: `1px solid ${p.rule}`, padding: '25px 0', opacity: amount(time, .25 + i * .45, .8 + i * .45)}}>
    <span style={{width: 26, height: 26, border: `2px solid ${p.gate}`, display: 'inline-block', flexShrink: 0}}/>
    <span style={{fontSize: 35}}>{label}</span>
  </div>)}</div>
</div>;

export const RenderedArtifact = ({time}: GraphicProps) => {
  const progress = amount(time, .3, 1.8);
  return <div style={{display: 'flex', alignItems: 'center', gap: 70, transform: `translateY(${(1 - progress) * 70}px)`, opacity: progress}}>
    <div style={{width: 1050, height: 360, position: 'relative', background: p.ink, color: p.paper, padding: '45px 55px', boxSizing: 'border-box'}}>
      <div style={{fontSize: 20, fontFamily: fonts.mono, color: p.muted, letterSpacing: 2}}>CLAUDE PROMPTS</div>
      <div style={{fontSize: 61, lineHeight: 1.03, width: 640, marginTop: 26, fontWeight: 600}}>Compose the work.<br/>Check the result.</div>
      <Img src={staticFile('mark-reversed.svg')} style={{position: 'absolute', right: 50, top: 55, width: 210, height: 160}}/>
      <svg width="920" height="55" style={{marginTop: 28}}><path d="M0 25H920" stroke={p.route} strokeWidth="3"/><rect x="600" y="15" width="20" height="20" fill={p.gate}/></svg>
    </div>
    <div style={{width: 470}}>
      <div style={{fontFamily: fonts.mono, fontSize: 22, marginBottom: 20}}>EDITABLE ARTIFACTS</div>
      <div style={{fontSize: 35, lineHeight: 1.4}}>Script → color script<br/>Motion → frame export</div>
      <div style={{display: 'flex', gap: 6, marginTop: 32}}>{Array.from({length: 6}, (_, i) => <div key={i} style={{width: 67, height: 43, background: i === 4 ? p.gate : p.ink, borderBottom: `4px solid ${p.route}`, opacity: amount(time, 3 + i * .3, 3.5 + i * .3)}}/>)}</div>
      <div style={{fontFamily: fonts.mono, fontSize: 20, marginTop: 20}}>poster + silent film trial</div>
    </div>
  </div>;
};

export const SceneGraphic = (props: GraphicProps) => {
  switch (props.scene.kind) {
    case 'problem': return <Fragments {...props}/>;
    case 'identity': return <Img src={staticFile('mark.svg')} style={{width: 480, height: 363, position: 'absolute', right: 30, top: -270, opacity: amount(props.time, .4, 1.6)}}/>;
    case 'compose': return <Primitives {...props}/>;
    case 'request': return <Request {...props}/>;
    case 'agents': return <AgentRoutes {...props}/>;
    case 'check': return <Checkpoint {...props}/>;
    case 'result': return <RenderedArtifact {...props}/>;
    case 'cta': return <div><Request {...props}/><Img src={staticFile('mark-reversed.svg')} style={{position: 'absolute', right: 45, bottom: 35, width: 250, height: 190}}/></div>;
  }
};
