#!/usr/bin/env bash
# Render the two casts into the README clip without re-running anything:
#   hero.cast  → hero.warped.cast  (beats.json) → session.gif → session.mp4
#   trace.cast → trace.warped.cast (same time map)        → trace.gif  → trace.mp4
#   compose.mjs lays the trace beside the session (slide-in scenes, captions, title)
#   → assets/demos/hero-demo.mp4 / .webm / .gif
# Re-pacing, captions and scenes all live in beats.json; change it and run again.
#
# The MP4 is built from agg's GIFs rather than replayed through VHS: VHS sizes its terminal in
# pixels, so a 120x36 cast re-wraps unless Width/Height happen to land on exactly that grid,
# and the replay came out scrambled (measured 2026-10-21).
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$HERO_DIR"
OUT="${OUT:-$HERO_DIR/../..}"                      # OUT=/tmp/x to render a rehearsal without touching the README assets
BEATS="${BEATS:-beats.json}"; CAST="${CAST:-hero.cast}"; TRACE_CAST="${TRACE_CAST:-trace.cast}"
WORK="${WORK:-/tmp/cpm-hero-render}"; mkdir -p "$WORK"
AGG=(agg --theme "${THEME:-monokai}" --font-family "Fira Code" --font-size "${FONT_SIZE:-15}" --fps-cap "${FPS:-12}" --idle-time-limit 3600 --last-frame-duration 4)   # idle is already capped by warp.mjs; agg capping it again shrank the trace track against the session (2026-10-21)

node warp.mjs "$CAST" "$BEATS" hero.warped.cast
"${AGG[@]}" hero.warped.cast "$WORK/session.gif"
ffmpeg -v error -y -i "$WORK/session.gif" -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -crf 18 "$WORK/session.mp4"

if [ -f "$TRACE_CAST" ]; then
  node warp.mjs "$TRACE_CAST" --map hero.timemap.json --align "$CAST" trace.warped.cast
  "${AGG[@]}" trace.warped.cast "$WORK/trace.gif"
  ffmpeg -v error -y -i "$WORK/trace.gif" -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -crf 18 "$WORK/trace.mp4"
  node compose.mjs hero.warped.cast "$BEATS" "$WORK/session.mp4" "$WORK/trace.mp4" "$OUT/hero-demo.mp4"
else
  cp "$WORK/session.mp4" "$OUT/hero-demo.mp4"
fi
# The README's GIF fallback has to stay small: fewer frames, fewer colours and a narrower frame
# than the MP4, which keeps the full-size composition. 12 fps: 8 stuttered on the panel slides,
# 15 cost another 0.7 MB for no visible gain (compared 2026-10-27, .grade/2026-10-21/hero-demo-take3/compare).
ffmpeg -v error -y -i "$OUT/hero-demo.mp4" -vf "fps=${GIF_FPS:-12},scale=${GIF_WIDTH:-900}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${GIF_COLORS:-64}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" "$OUT/hero-demo.gif"
for f in gif mp4; do
  printf "%s\t%s bytes\t%ss\n" "hero-demo.$f" "$(stat -c %s "$OUT/hero-demo.$f")" \
    "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/hero-demo.$f")"
done
