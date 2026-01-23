import { Composition, Folder } from "remotion";

// Demo compositions
import {
  ChainFlow,
  FrameworkInjection,
  GateSystem,
  HeroIntro,
  SymbolicSyntax,
  TerminalDemo,
} from "./compositions";

// Shared constants
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Main Demo Videos */}
      <Folder name="Demos">
        <Composition
          id="HeroIntro"
          component={HeroIntro}
          durationInFrames={10 * FPS}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />

        <Composition
          id="SymbolicSyntax"
          component={SymbolicSyntax}
          durationInFrames={15 * FPS}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
        <Composition
          id="ChainFlow"
          component={ChainFlow}
          durationInFrames={20 * FPS}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />

        <Composition
          id="GateSystem"
          component={GateSystem}
          durationInFrames={15 * FPS}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />

        <Composition
          id="FrameworkInjection"
          component={FrameworkInjection}
          durationInFrames={15 * FPS}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />

        <Composition
          id="TerminalDemo"
          component={TerminalDemo}
          durationInFrames={20 * FPS}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
      </Folder>
    </>
  );
};
