import {Config} from '@remotion/cli/config';

// WebGL in headless Chromium on this GPU-less WSL2 box: measured 2026-10-07, `angle`, `swiftshader` and
// `angle-egl` all fail to create a context; `swangle` (SwiftShader on ANGLE) renders Beat4 frame 90 in ~4.5 s.
Config.setChromiumOpenGlRenderer('swangle');
