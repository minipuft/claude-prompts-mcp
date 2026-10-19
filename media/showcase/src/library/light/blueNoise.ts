/**
 * A fixed blue-noise threshold tile by void-and-cluster (Ulichney 1993), 64 x 64, ranks scaled to bytes. Seeded by a fixed LCG: the same tile on every run and every machine (integer and float64 arithmetic
 * only). The light pass thresholds against it, so a lit area becomes evenly spaced dots, never clumps or bands: the stipple of D48.
 */
const N = 64, SIGMA = 1.9, RADIUS = 8;

let tile: Uint8Array | null = null;

export const blueNoise = (): Uint8Array => {
  if (tile) return tile;
  const kernel = new Float64Array((2 * RADIUS + 1) ** 2);
  for (let dy = -RADIUS; dy <= RADIUS; dy++) for (let dx = -RADIUS; dx <= RADIUS; dx++) kernel[(dy + RADIUS) * (2 * RADIUS + 1) + dx + RADIUS] = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
  const energy = new Float64Array(N * N);
  const on = new Uint8Array(N * N);
  const splat = (i: number, sign: number) => {
    const x = i % N, y = (i / N) | 0;
    for (let dy = -RADIUS; dy <= RADIUS; dy++) for (let dx = -RADIUS; dx <= RADIUS; dx++) energy[(((y + dy + N) % N) * N) + ((x + dx + N) % N)]! += sign * kernel[(dy + RADIUS) * (2 * RADIUS + 1) + dx + RADIUS]!;
  };
  const toggle = (i: number, v: 0 | 1) => { if (on[i] === v) return; on[i] = v; splat(i, v ? 1 : -1); };
  // the tightest cluster is the set pixel of highest energy, the largest void the unset pixel of lowest (first index on a tie, so the result is deterministic)
  const tightest = () => { let best = -1, e = -Infinity; for (let i = 0; i < N * N; i++) if (on[i] && energy[i]! > e) { e = energy[i]!; best = i; } return best; };
  const largestVoid = () => { let best = -1, e = Infinity; for (let i = 0; i < N * N; i++) if (!on[i] && energy[i]! < e) { e = energy[i]!; best = i; } return best; };
  // the initial pattern: a tenth of the pixels from a fixed LCG, relaxed until moving the tightest cluster into the largest void changes nothing
  let seed = 0x2545f491;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let k = 0; k < (N * N) / 10; ) { const i = Math.floor(rnd() * N * N); if (!on[i]) { toggle(i, 1); k++; } }
  for (let guard = 0; guard < N * N; guard++) {
    const c = tightest();
    toggle(c, 0);
    const v = largestVoid();
    toggle(v, 1);
    if (v === c) break;
  }
  const rank = new Int32Array(N * N);
  const initial = Uint8Array.from(on);
  const ones = initial.reduce((a, b) => a + b, 0);
  // phase 1: remove ones from the tightest cluster, ranking them downward
  for (let r = ones - 1; r >= 0; r--) { const c = tightest(); rank[c] = r; toggle(c, 0); }
  on.set(initial); energy.fill(0); for (let i = 0; i < N * N; i++) if (on[i]) splat(i, 1);
  // phases 2 and 3: add ones to the largest void, ranking upward, until every pixel is ranked (past half, the largest void of the ones is the tightest cluster of the zeros)
  for (let r = ones; r < N * N; r++) { const v = largestVoid(); rank[v] = r; toggle(v, 1); }
  tile = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) tile[i] = Math.floor((rank[i]! * 256) / (N * N));
  return tile;
};

export const BLUE_NOISE_SIZE = N;
