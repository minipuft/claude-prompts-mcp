/**
 * The light layer's three programs (D98). GLSL ES 3.00, run by three's ShaderMaterial on a full-screen quad. All state is in the uniforms and the textures: no clock, no random, no derivative of the frame number,
 * so a drawing is a function of its inputs and of the backend that ran it (the manifest records the backend). Buffer coordinates throughout: origin bottom-left, pixel centres at +0.5.
 *
 * Mask texture (RGBA8, one texel per pixel): a > 0.5 a solid is drawn there; r its material's albedo; g its shadow class / 3 (0 casts no shadow); b its group's byte (index * 32 + 16).
 * Seed texture (RGBA32F): xy the centre of the nearest shadow-casting solid pixel, zw the centre of the nearest pixel that is not one, so one flood holds both halves of the signed distance.
 */
export const VERT = `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** Pass 1: the mask becomes seeds. A pixel is its own nearest seed for the half of the field it belongs to; the other half starts infinitely far. */
export const SEED_FRAG = `
uniform sampler2D uMask;
void main() {
  vec2 p = gl_FragCoord.xy;
  vec4 m = texelFetch(uMask, ivec2(p), 0);
  bool solid = m.a > 0.5 && m.g > 0.1;
  vec2 far = vec2(-100000.0);
  gl_FragColor = solid ? vec4(p, far) : vec4(far, p);
}
`;

/** Pass 2 (log2(width) times, the step halving from 1024 to 1): one jump-flood step over both halves. */
export const FLOOD_FRAG = `
uniform sampler2D uSeeds;
uniform vec2 uSize;
uniform float uStep;
void main() {
  vec2 p = gl_FragCoord.xy;
  vec4 best = texelFetch(uSeeds, ivec2(p), 0);
  float dA = distance(p, best.xy), dB = distance(p, best.zw);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 q = p + vec2(float(i), float(j)) * uStep;
      if (q.x < 0.0 || q.y < 0.0 || q.x >= uSize.x || q.y >= uSize.y) continue;
      vec4 s = texelFetch(uSeeds, ivec2(q), 0);
      float a = distance(p, s.xy);
      if (a < dA) { dA = a; best.xy = s.xy; }
      float b = distance(p, s.zw);
      if (b < dB) { dB = b; best.zw = s.zw; }
    }
  }
  gl_FragColor = best;
}
`;

/** Pass 3: the light. Direct falloff times a sphere-traced soft shadow, plus one bounce off the lit edges, thresholded by a fixed blue-noise tile into dots or nothing. */
export const LIGHT_FRAG = `
uniform sampler2D uMask;
uniform sampler2D uSeeds;
uniform sampler2D uNoise;
uniform vec2 uSize;
uniform vec2 uEmitter;
uniform float uSeat;
uniform float uR0;
uniform float uReach;
uniform float uGuard;
uniform vec3 uDot;
uniform vec3 uRadiance;
uniform vec3 uAccent;
uniform float uGroupAccent[8];
uniform float uOwner;
uniform float uOwnerSeat;
uniform vec3 uShadowK;
uniform vec3 uStipplePx;
uniform float uBounceGain;
uniform float uBounceReach;
uniform float uBounceLuma;
uniform int uStepsFine;
uniform int uStepsCoarse;

vec2 clampPx(vec2 q) { return clamp(q, vec2(0.5), uSize - 0.5); }

// Signed distance to the nearest shadow-casting solid, in px: negative inside. 'seed' is the nearest such pixel.
float sdAt(vec2 q, out vec2 seed) {
  ivec2 ip = ivec2(floor(clampPx(q)));
  vec4 s = texelFetch(uSeeds, ip, 0);
  vec2 c = vec2(ip) + 0.5;
  seed = s.xy;
  float dOut = distance(c, s.xy);
  if (dOut < 0.25) return -distance(c, s.zw);
  return dOut;
}

float classAt(vec2 seed) { return floor(texelFetch(uMask, ivec2(floor(seed)), 0).g * 3.0 + 0.5); }
float groupAt(vec2 seed) { return floor(texelFetch(uMask, ivec2(floor(seed)), 0).b * 255.0 / 32.0); }
float kOf(float c) { return c < 1.5 ? uShadowK.x : (c < 2.5 ? uShadowK.y : uShadowK.z); }
float stippleOf(float c) { return c < 0.5 ? 1.0 : (c < 1.5 ? uStipplePx.x : (c < 2.5 ? uStipplePx.y : uStipplePx.z)); }

// The volume: the inverse square 1/(1+(d/r0)^2), less its value at the reach so it arrives at nothing there: highest at the lamp, falling with distance, no floor.
float litAt(float d) {
  float f = 1.0 / (1.0 + (d * d) / (uR0 * uR0));
  float ft = 1.0 / (1.0 + (uReach * uReach) / (uR0 * uR0));
  return clamp((f - ft) / (1.0 - ft), 0.0, 1.0);
}

// Sphere-traced soft shadow toward the emitter: min(k * h / t) over the march, k from the class of the solid that sets the minimum. A hit returns 0. 'cls' is that solid's class (0: none in the way).
float shadowMarch(vec2 from, float stepMin, int maxSteps, out float cls) {
  vec2 to = uEmitter - from;
  float len = length(to);
  cls = 0.0;
  if (len < 1.0) return 1.0;
  vec2 dir = to / len;
  float tmax = len - uSeat;
  float t = 1.5;
  float res = 1.0;
  for (int n = 0; n < 128; n++) {
    if (n >= maxSteps || t >= tmax) break;
    vec2 seed;
    float h = sdAt(from + dir * t, seed);
    float c = classAt(seed);
    // the solid the emitter sits in lets its light out near the emitter: step through it without casting
    if (groupAt(seed) == uOwner && len - t < uOwnerSeat) { t += clamp(abs(h), stepMin, 48.0); continue; }
    if (h < 0.75) { cls = c; return 0.0; }
    float r = kOf(c) * h / t;
    if (r < res) { res = r; cls = c; }
    t += clamp(h, stepMin, 48.0);
  }
  return clamp(res, 0.0, 1.0);
}

// One bounce: the nearest solid edge, if it faces the light and is lit, gives back its albedo in the pair colour nearest its role's hue, falling off with distance from the edge.
float bounceAt(vec2 p, out vec3 tint) {
  tint = vec3(0.0);
  vec2 seed;
  float d = sdAt(p, seed);
  if (d > uBounceReach) return 0.0;
  vec4 mm = texelFetch(uMask, ivec2(floor(seed)), 0);
  vec2 toE = uEmitter - seed;
  float ls = length(toE);
  if (ls < 1.0) return 0.0;
  vec2 q = seed + toE / ls * 3.0;
  vec2 sq;
  if (sdAt(q, sq) < 0.75) return 0.0;
  float cls;
  float vis = shadowMarch(q, 3.0, uStepsCoarse, cls);
  vis = vis * vis * (3.0 - 2.0 * vis);
  tint = uGroupAccent[int(floor(mm.b * 255.0 / 32.0))] > 0.5 ? uAccent : uRadiance;
  float fall = 1.0 - d / uBounceReach;
  return mm.r * litAt(ls) * vis * uBounceGain * fall * fall;
}

float noiseAt(vec2 cell) { return texelFetch(uNoise, ivec2(cell) & 63, 0).r; }

void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 seed0;
  float sd = sdAt(p, seed0);
  if (texelFetch(uMask, ivec2(p), 0).a > 0.5 || sd < uGuard) { gl_FragColor = vec4(0.0); return; }
  float lit = litAt(distance(p, uEmitter));
  float cls = 0.0;
  float vis = 1.0;
  if (lit > 0.0) {
    vis = shadowMarch(p, 1.0, uStepsFine, cls);
    vis = vis * vis * (3.0 - 2.0 * vis);
  }
  float direct = lit * vis;
  vec3 tint;
  float bounce = bounceAt(p, tint);
  // the shadow's own edge is drawn in the stipple of its class: coarser dots where the class is harder (the weighted edge, D47); fully lit pixels take the finest
  float scale = vis < 0.98 ? stippleOf(cls) : 1.0;
  vec2 cell = floor(p / scale);
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (noiseAt(cell) < direct) { col = uDot; a = 1.0; }
  else if (noiseAt(cell + vec2(31.0, 17.0)) < bounce) { col = tint * uBounceLuma; a = 1.0; }
  gl_FragColor = vec4(col, a);
}
`;
