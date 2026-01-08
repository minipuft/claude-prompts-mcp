#!/usr/bin/env bash
set -euo pipefail

# Render .dot graph sources in server/graphs to SVG (and optionally validate)

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
GRAPHS_DIR="$ROOT_DIR/server/graphs"
OUT_DIR="$GRAPHS_DIR" # keep outputs next to sources; .svg ignored by git

if ! command -v dot >/dev/null 2>&1; then
  echo "Graphviz 'dot' not found. Install graphviz to render diagrams." >&2
  exit 0 # Non-blocking: skip when not installed
fi

shopt -s nullglob
DOT_FILES=("$GRAPHS_DIR"/*.dot)

if [ ${#DOT_FILES[@]} -eq 0 ]; then
  echo "No .dot files found in $GRAPHS_DIR"
  exit 0
fi

echo "Rendering ${#DOT_FILES[@]} graph(s) to SVG..."
for dotf in "${DOT_FILES[@]}"; do
  base="$(basename "$dotf" .dot)"
  svg="$OUT_DIR/$base.svg"
  echo " - $base.dot -> $base.svg"
  dot -Tsvg "$dotf" -o "$svg"
done

if [[ "${1:-}" == "--validate" ]]; then
  echo "Validating generated SVGs exist..."
  missing=0
  for dotf in "${DOT_FILES[@]}"; do
    base="$(basename "$dotf" .dot)"
    svg="$OUT_DIR/$base.svg"
    if [ ! -s "$svg" ]; then
      echo "Missing or empty: $svg" >&2
      missing=1
    fi
  done
  if [ $missing -ne 0 ]; then
    echo "Graph validation failed" >&2
    exit 1
  fi
fi

echo "Done."

