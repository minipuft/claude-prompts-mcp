import {Color, DoubleSide, ShaderMaterial, Vector3, type Texture} from 'three';

/**
 * One fragment program for the figure in the line and shaded worlds. It reads only the figure's own texture (the generated drawing):
 * the contour it draws is the edges between the drawing's colour regions (found on a blurred mip so the stipple does not draw), kept off
 * the silhouette band, which outline.ts strokes along the mesh boundary; the stepped fill quantises a light taken from the alpha's blurred
 * height field (the figure's own roundness, no extra geometry).
 * `fillAlpha` and `lineAlpha` are independent, which is how a crossing takes the fills out and leaves the lines in one render.
 */
const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragment = /* glsl */ `
uniform sampler2D map;
uniform vec2 texel;
uniform float widthTex;
uniform vec3 lineColour;
uniform float lineAlpha;
uniform float fillAlpha;
uniform float steps;
uniform vec3 lightDir;
uniform vec3 coolShadow;
uniform float shadowFloor;
uniform float stepAt;
varying vec2 vUv;

float alphaAt(vec2 o) { return texture2D(map, vUv + o * texel).a; }
vec3 soft(vec2 o) { return texture2D(map, vUv + o * texel, 1.8).rgb; }

void main() {
  float a0 = alphaAt(vec2(0.0));
  if (a0 < 0.05) discard;
  float w = widthTex;
  float mn = a0;
  for (int i = 0; i < 8; i++) {
    float t = float(i) * 0.785398;
    mn = min(mn, alphaAt(vec2(cos(t), sin(t)) * w));
  }
  vec3 gx = soft(vec2(w * 0.45, 0.0)) - soft(vec2(-w * 0.45, 0.0));
  vec3 gy = soft(vec2(0.0, w * 0.45)) - soft(vec2(0.0, -w * 0.45));
  float inner = smoothstep(0.34, 0.46, length(gx) + length(gy)) * smoothstep(0.5, 0.9, mn);
  float la = inner * lineAlpha;  // the silhouette is the fat line along the mesh boundary (outline.ts)

  vec3 fill = texture2D(map, vUv).rgb;
  if (steps > 0.5) {
    // the height field is the alpha blurred over a limb's width (r texels, mip 5.5), so a limb reads as a rounded bar and its far side falls into shadow
    float r = 46.0;
    float hx = texture2D(map, vUv + vec2(r, 0.0) * texel, 5.5).a - texture2D(map, vUv - vec2(r, 0.0) * texel, 5.5).a;
    float hy = texture2D(map, vUv + vec2(0.0, r) * texel, 5.5).a - texture2D(map, vUv - vec2(0.0, r) * texel, 5.5).a;
    vec3 n = normalize(vec3(-hx * 3.0, -hy * 3.0, 1.0));
    float l = clamp(dot(n, normalize(lightDir)) * 0.5 + 0.5, 0.0, 1.0);
    // stepAt is the light level the lit step begins at (0.5 = steps of equal width)
    float level = floor(clamp(l + 0.5 - stepAt, 0.0, 0.9999) * steps) / max(steps - 1.0, 1.0);
    float k = mix(shadowFloor, 1.0, level);
    fill = mix(fill * k, coolShadow * k, (1.0 - level) * 0.35);
  }

  float alpha = la + fillAlpha * (1.0 - la);
  if (alpha < 0.01) discard;
  vec3 rgb = (lineColour * la + fill * fillAlpha * (1.0 - la)) / alpha;
  gl_FragColor = vec4(rgb, alpha);
  #include <colorspace_fragment>
}`;

export type FigureShaderState = {
  widthTex: number;
  lineColour: string;
  lineAlpha: number;
  fillAlpha: number;
  /** 0 = the texture as drawn; N >= 2 = N lighting steps. */
  steps: number;
  /** Light direction, shadow floor and the lit step's threshold; omitted keeps the material's last value. */
  lightDir?: [number, number, number];
  shadowFloor?: number;
  stepAt?: number;
};

export const makeFigureMaterial = (texture: Texture): ShaderMaterial => {
  const image = texture.image as {width: number; height: number};
  return new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      map: {value: texture},
      texel: {value: [1 / image.width, 1 / image.height]},
      widthTex: {value: 5},
      lineColour: {value: new Color('#ffffff')},
      lineAlpha: {value: 1},
      fillAlpha: {value: 0},
      steps: {value: 0},
      lightDir: {value: new Vector3(-0.5, -0.6, 0.65)},
      coolShadow: {value: new Color('#1a2a6a')},
      shadowFloor: {value: 0.58},
      stepAt: {value: 0.5},
    },
  });
};

/** Write one frame's state into the material's uniforms. */
export const setFigureState = (m: ShaderMaterial, s: FigureShaderState): void => {
  const u = m.uniforms as Record<string, {value: unknown}>;
  u.widthTex!.value = s.widthTex;
  (u.lineColour!.value as Color).set(s.lineColour);
  u.lineAlpha!.value = s.lineAlpha;
  u.fillAlpha!.value = s.fillAlpha;
  u.steps!.value = s.steps;
  if (s.lightDir) (u.lightDir!.value as Vector3).set(...s.lightDir);
  if (s.shadowFloor !== undefined) u.shadowFloor!.value = s.shadowFloor;
  if (s.stepAt !== undefined) u.stepAt!.value = s.stepAt;
};
