import {Composition} from 'remotion';
import {ShowcaseFilm} from './film';
import {story} from './story';
import {Beat4Still} from './scenes/Beat4Still';
import {Beats45} from './scenes/Beats45';
import {Beat1Opening} from './scenes/Beat1Opening';
import {SkinSwatch} from './scenes/SkinSwatch';
import {HumanSheet} from './sheets/HumanSheet';
import {HumanSheet2} from './sheets/HumanSheet2';
import {PuppetProof} from './scenes/PuppetProof';
import {MeshProof} from './scenes/MeshProof';
import {RigSheet} from './scenes/RigSheet';
import {ModelSheet} from './scenes/ModelSheet';
import {LayoutSheet, type LayoutContract} from './scenes/LayoutSheet';
import {WorldCrossingMeasure, WorldCrossingProof, WorldReel, WorldSheet} from './scenes/WorldSheet';
import {Animatic, CameraReelHome} from './scenes/Animatic';
import {PoseSheet} from './scenes/PoseSheet';
import {ShotS01} from './scenes/ShotS01';
import {PoseSheetS01, type PlateInfo} from './scenes/PoseSheetS01';
import s01Keys from '../v3/keys/s01-arrival-overwhelm.json';
import s01Plates from '../assets/human/keys/s01-arrival-overwhelm/plates.json';
import {KEY_FILM, KeyFilmS01} from './scenes/KeyFilmS01';
import {XSheetPage} from './scenes/XSheet';
import {REEL_FRAMES, timeline} from './scenes/animaticPlan';
import {parseKeySheet} from './library/animation/keys';
import s02Keys from '../v3/keys/s02-cant-build-frame.json';
import s02Layout from '../v3/layouts/s02-cant-build-frame.json';
import s01Layout from '../v3/layouts/s01-arrival-overwhelm.json';
import humanModel from '../assets/human/model.json';

export const RemotionRoot = () => <>
  <Composition id="WorldSheetHome" component={WorldSheet} width={1280} height={720} fps={30} durationInFrames={1} defaultProps={{world: 'home' as const}}/>
  <Composition id="WorldSheetCrayon" component={WorldSheet} width={1280} height={720} fps={30} durationInFrames={1} defaultProps={{world: 'crayon' as const}}/>
  <Composition id="WorldSheetLine" component={WorldSheet} width={1280} height={720} fps={30} durationInFrames={1} defaultProps={{world: 'line' as const}}/>
  <Composition id="WorldSheetShaded" component={WorldSheet} width={1280} height={720} fps={30} durationInFrames={1} defaultProps={{world: 'shaded' as const}}/>
  <Composition id="WorldCrossingProof" component={WorldCrossingProof} width={1280} height={720} fps={30} durationInFrames={120}/>
  <Composition id="WorldCrossingMeasure" component={WorldCrossingMeasure} width={1280} height={1160} fps={30} durationInFrames={120}/>
  <Composition id="WorldReelHome" component={WorldReel} width={1280} height={720} fps={30} durationInFrames={48} defaultProps={{world: 'home' as const}}/>
  <Composition id="WorldReelCrayon" component={WorldReel} width={1280} height={720} fps={30} durationInFrames={48} defaultProps={{world: 'crayon' as const}}/>
  <Composition id="WorldReelLine" component={WorldReel} width={1280} height={720} fps={30} durationInFrames={48} defaultProps={{world: 'line' as const}}/>
  <Composition id="WorldReelShaded" component={WorldReel} width={1280} height={720} fps={30} durationInFrames={48} defaultProps={{world: 'shaded' as const}}/>
  <Composition id="LayoutSheetS02" component={LayoutSheet} width={1280} height={720} fps={30} durationInFrames={1} defaultProps={{layout: s02Layout}}/>
  <Composition id="LayoutSheetS01" component={LayoutSheet} width={1280} height={720} fps={30} durationInFrames={1} defaultProps={{layout: s01Layout as unknown as LayoutContract}}/>
  <Composition id="PoseSheetS02" component={PoseSheet} width={1280} height={720} fps={30} durationInFrames={1} defaultProps={{sheet: parseKeySheet(s02Keys)}}/>
  <Composition id="Animatic65" component={Animatic} width={1280} height={720} fps={timeline.fps} durationInFrames={timeline.durationInFrames}/>
  <Composition id="PoseSheetS01" component={PoseSheetS01} width={2400} height={1190} fps={30} durationInFrames={1} defaultProps={{sheet: parseKeySheet(s01Keys), plates: s01Plates.map((k): PlateInfo => ({key: k.key, name: k.name, plate: k.plate, family: k.family, cropPx: [k.cropPx[0]!, k.cropPx[1]!], baselineInCrop: k.baselineInCrop, scale: k.scale, originMask: [k.originMask[0]!, k.originMask[1]!]}))}}/>
  <Composition id="KeyFilmS01" component={KeyFilmS01} width={KEY_FILM.size[0]} height={KEY_FILM.size[1]} fps={30} durationInFrames={9}/>
  <Composition id="ShotS01" component={ShotS01} width={1280} height={720} fps={30} durationInFrames={420}/>
  <Composition id="ShotS01Figure" component={ShotS01} width={1280} height={720} fps={30} durationInFrames={420} defaultProps={{layers: 'figure' as const}}/>
  <Composition id="XSheetPage" component={XSheetPage} width={1280} height={720} fps={30} durationInFrames={1} defaultProps={{from: 800, count: 40}}/>
  <Composition id="CameraReelHome" component={CameraReelHome} width={1280} height={720} fps={30} durationInFrames={REEL_FRAMES}/>
  <Composition id="ModelSheetHuman" component={ModelSheet} width={1280} height={720} fps={30} durationInFrames={1} defaultProps={{model: humanModel}}/>
  <Composition id="RigSheet" component={RigSheet} width={1280} height={720} fps={30} durationInFrames={1}/>
  <Composition id="PuppetProof" component={PuppetProof} width={1280} height={720} fps={30} durationInFrames={90}/>
  <Composition id="MeshProof" component={MeshProof} width={1280} height={720} fps={30} durationInFrames={90}/>
  <Composition id="HumanSheet2" component={HumanSheet2} width={1280} height={720} fps={30} durationInFrames={1}/>
  <Composition id="HumanSheet" component={HumanSheet} width={1280} height={720} fps={30} durationInFrames={1}/>
  <Composition id="SkinSwatch" component={SkinSwatch} width={1280} height={720} fps={30} durationInFrames={1}/>
  <Composition id="Beat1" component={Beat1Opening} width={1280} height={720} fps={30} durationInFrames={120}/>
  <Composition id="Beats45" component={Beats45} width={1280} height={720} fps={30} durationInFrames={240}/>
  <Composition id="Beat4" component={Beat4Still} width={1280} height={720} fps={30} durationInFrames={120}/>
  <Composition id="Showcase" component={ShowcaseFilm}
  width={story.width} height={story.height} fps={story.fps} durationInFrames={story.durationInFrames}/>
</>;
