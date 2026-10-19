import {useLayoutEffect, useRef} from 'react';
import {cancelRender, continueRender, delayRender, staticFile} from 'remotion';
import {drawLightSdf, maskFromImage} from './sdfDraw';
import {SDF_SIZE, type SdfP} from './sdf';

/** Where a drawing's occluder mask lives in the served bundle: `scripts/animation/render-cached.mjs` writes the full-frame mask of each `occluders` drawing here before the light is drawn. */
export const maskFile = (id: string): string => staticFile(`lightsdf-in/${id}.png`);

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`light-sdf: the occluder mask ${src} did not load (the occluders pass must be drawn and expanded before the light)`));
  img.src = src;
});

/**
 * The light layer on a transparent canvas of the frame's size (D98). `blend` is how it sits over the picture: 'screen' in the whole frame, 'normal' when one drawing is cut for the cache (the compositor then
 * screens it, as it does the lamp's core). The frame waits for the mask and the draw.
 */
export const LightSdf: React.FC<{p: SdfP; blend: 'screen' | 'normal'}> = ({p, blend}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(p);
  // One hold per drawing, taken before the frame is painted and released when that drawing is on the canvas. A tab that renders consecutive frames keeps this component mounted, so a hold taken once per mount
  // would let the second frame be captured with the first frame's light (measured on confirm frame 210 of s01: a whole-frame render read 35 381 pixels off the cached drawing).
  useLayoutEffect(() => {
    let done = false;
    const handle = delayRender(`light-sdf ${p.occ}`, {timeoutInMilliseconds: 180000});
    const release = () => { if (!done) { done = true; continueRender(handle); } };
    (async () => {
      try {
        const img = await loadImage(maskFile(p.occ));
        if (done || !ref.current) return;
        drawLightSdf(ref.current, p, maskFromImage(img));
        release();
      } catch (e) {
        cancelRender(e);
      }
    })();
    return release;
  }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps -- the drawing is a function of the projection's content, not of the object's identity
  return <canvas key={key} ref={ref} width={SDF_SIZE.width} height={SDF_SIZE.height} style={{position: 'absolute', left: 0, top: 0, width: SDF_SIZE.width, height: SDF_SIZE.height, mixBlendMode: blend === 'screen' ? 'screen' : 'normal', pointerEvents: 'none'}} />;
};
