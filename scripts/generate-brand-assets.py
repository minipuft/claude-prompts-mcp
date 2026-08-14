#!/usr/bin/env python3
"""Generate and validate the canonical Claude Prompts brand assets.

The tracked symbol source is self-contained. Raster output uses a local Chromium-
family browser so SVG masks are sampled by the same class of renderer used by
GitHub and README consumers.
"""

from __future__ import annotations

import argparse
import re
import shutil
import struct
import subprocess
import tempfile
import xml.etree.ElementTree as ElementTree
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets" / "brand"
SOURCE = BRAND / "source" / "claude-prompts-symbols.svg"
PNG_DIR = BRAND / "png"

INK = "#111715"
PAPER = "#F5F7F6"
ROUTE = "#2A8F83"
GATE = "#E3A63B"

MARK_SIZES = (16, 24, 32, 64, 128, 256, 512, 1024)


def source_defs() -> str:
    source = SOURCE.read_text()
    match = re.search(r"<defs>(.*?)</defs>", source, re.DOTALL)
    if not match:
        raise ValueError(f"Missing defs in {SOURCE}")
    return match.group(1)


def mark_svg(symbol: str, color: str, title: str, description: str) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 148 112" role="img" aria-labelledby="title desc">
<title id="title">{title}</title>
<desc id="desc">{description}</desc>
<defs>{source_defs()}</defs>
<use href="#{symbol}" width="148" height="112" style="color:{color}"/>
</svg>
'''


def square_mark_svg(symbol: str, color: str, size: int) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 148 148">
<defs>{source_defs()}</defs>
<use href="#{symbol}" x="0" y="18" width="148" height="112" style="color:{color}"/>
</svg>
'''


def avatar_svg() -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 500 500"
role="img" aria-labelledby="title desc">
<title id="title">Claude Prompts avatar</title>
<desc id="desc">White Claude Prompts mascot mark on a dark square field.</desc>
<defs>{source_defs()}</defs>
<rect width="500" height="500" fill="{INK}"/>
<circle cx="418" cy="82" r="9" fill="{GATE}"/>
<path d="M382 82h21" fill="none" stroke="{ROUTE}" stroke-width="5" stroke-linecap="round"/>
<use href="#mark" x="65" y="114" width="370" height="280" style="color:{PAPER}"/>
</svg>
'''


def social_preview_svg() -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 1280 640"
role="img" aria-labelledby="title desc">
<title id="title">Claude Prompts repository social preview</title>
<desc id="desc">Claude Prompts mascot with product name and portable prompt workflow description.</desc>
<defs>{source_defs()}</defs>
<rect width="1280" height="640" fill="{INK}"/>
<path d="M76 82h1128" fill="none" stroke="{ROUTE}" stroke-width="4"/>
<circle cx="1178" cy="82" r="10" fill="{GATE}"/>
<use href="#mark" x="70" y="166" width="430" height="326" style="color:{PAPER}"/>
<g font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif">
  <text x="570" y="236" fill="{ROUTE}" font-size="22" font-weight="700"
    letter-spacing="3">PORTABLE WORKFLOW LAYER</text>
  <text x="566" y="330" fill="{PAPER}" font-size="76" font-weight="750" letter-spacing="-2">Claude Prompts</text>
  <text x="570" y="390" fill="#B9C4C0" font-size="30" font-weight="450">Prompt workflows for AI coding clients</text>
  <text x="570" y="464" fill="{PAPER}" font-size="23" font-weight="600">
    MCP  ·  chains  ·  validation  ·  skills export</text>
</g>
</svg>
'''


def svg_assets() -> dict[str, str]:
    return {
        "claude-prompts-mark.svg": mark_svg(
            "mark", INK, "Claude Prompts mascot mark", "Canonical positive mascot mark."
        ),
        "claude-prompts-mark-reversed.svg": mark_svg(
            "mark", PAPER, "Claude Prompts reversed mascot mark", "Canonical light mascot mark for dark fields."
        ),
        "claude-prompts-mark-attention.svg": mark_svg(
            "mark-attention", INK, "Claude Prompts attention mark", "Optional attention state with additive pupils."
        ),
        "claude-prompts-mark-micro-24.svg": mark_svg(
            "mark-micro-24", INK, "Claude Prompts 24 pixel mark", "Responsive 24 pixel optical master."
        ),
        "claude-prompts-mark-micro-16.svg": mark_svg(
            "mark-micro-16",
            INK,
            "Claude Prompts 16 pixel mark",
            "Positive 16 pixel optical master with source-derived wedge apertures.",
        ),
        "claude-prompts-mark-micro-16-reversed.svg": mark_svg(
            "mark-micro-16-reversed",
            PAPER,
            "Claude Prompts reversed 16 pixel mark",
            "Reversed 16 pixel optical master with polarity compensation.",
        ),
        "claude-prompts-avatar.svg": avatar_svg(),
        "claude-prompts-social-preview.svg": social_preview_svg(),
    }


def write_svg_assets() -> None:
    BRAND.mkdir(parents=True, exist_ok=True)
    for name, content in svg_assets().items():
        (BRAND / name).write_text(content)


def browser_binary() -> str:
    candidates = ("google-chrome", "chromium", "chromium-browser", "chrome")
    for candidate in candidates:
        path = shutil.which(candidate)
        if path:
            return path
    raise RuntimeError("Chrome or Chromium is required to render PNG brand assets")


def render_svg(browser: str, svg: Path, png: Path, width: int, height: int) -> None:
    png.parent.mkdir(parents=True, exist_ok=True)
    viewport_width = max(width, 500)
    viewport_height = max(height, 500)
    screenshot = (
        png
        if (viewport_width, viewport_height) == (width, height)
        else png.with_name(f".{png.stem}-viewport.png")
    )
    wrapper = png.with_name(f".{png.stem}-render.html")
    wrapper.write_text(
        '<!doctype html><meta charset="utf-8"><style>'
        'html,body{margin:0;background:transparent;overflow:hidden}img{display:block}'
        f'</style><img src="{svg.resolve().as_uri()}" width="{width}" height="{height}" alt="">'
    )
    command = [
        browser,
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--hide-scrollbars",
        "--default-background-color=00000000",
        f"--screenshot={screenshot}",
        f"--window-size={viewport_width},{viewport_height}",
        wrapper.resolve().as_uri(),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Could not render {svg}: {result.stderr.strip()}")
    wrapper.unlink()
    if screenshot != png:
        crop_png(screenshot, png, width, height)
        screenshot.unlink()


def render_png_assets() -> None:
    browser = browser_binary()
    PNG_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="claude-prompts-brand-") as temporary:
        temporary_path = Path(temporary)
        for size in MARK_SIZES:
            positive_symbol = "mark-micro-16" if size == 16 else "mark-micro-24" if size == 24 else "mark"
            reversed_symbol = "mark-micro-16-reversed" if size == 16 else "mark-micro-24" if size == 24 else "mark"
            positive_svg = temporary_path / f"positive-{size}.svg"
            reversed_svg = temporary_path / f"reversed-{size}.svg"
            positive_svg.write_text(square_mark_svg(positive_symbol, INK, size))
            reversed_svg.write_text(square_mark_svg(reversed_symbol, PAPER, size))
            render_svg(browser, positive_svg, PNG_DIR / f"claude-prompts-mark-{size}.png", size, size)
            render_svg(browser, reversed_svg, PNG_DIR / f"claude-prompts-mark-reversed-{size}.png", size, size)

    render_svg(browser, BRAND / "claude-prompts-avatar.svg", BRAND / "claude-prompts-avatar-500.png", 500, 500)
    render_svg(browser, BRAND / "claude-prompts-avatar.svg", BRAND / "claude-prompts-icon-512.png", 512, 512)
    render_svg(
        browser,
        BRAND / "claude-prompts-social-preview.svg",
        BRAND / "claude-prompts-social-preview-1280x640.png",
        1280,
        640,
    )
    shutil.copyfile(BRAND / "claude-prompts-icon-512.png", ROOT / "assets" / "logo.png")
    shutil.copyfile(BRAND / "claude-prompts-icon-512.png", ROOT / "assets" / "icon-512.png")


def png_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError(f"Not a PNG: {path}")
    return struct.unpack(">II", data[16:24])


def decode_rgba_png(path: Path) -> tuple[int, int, list[bytes]]:
    data = path.read_bytes()
    width, height = png_dimensions(path)
    offset = 8
    compressed = bytearray()
    bit_depth = color_type = interlace = None
    while offset < len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        kind = data[offset + 4 : offset + 8]
        payload = data[offset + 8 : offset + 8 + length]
        offset += 12 + length
        if kind == b"IHDR":
            _, _, bit_depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", payload)
        elif kind == b"IDAT":
            compressed.extend(payload)
        elif kind == b"IEND":
            break
    if (bit_depth, color_type, interlace) != (8, 6, 0):
        raise ValueError(f"Expected non-interlaced RGBA PNG: {path}")
    raw = zlib.decompress(bytes(compressed))
    stride = width * 4
    rows: list[bytes] = []
    previous = bytearray(stride)
    cursor = 0
    for _ in range(height):
        filter_type = raw[cursor]
        cursor += 1
        encoded = bytearray(raw[cursor : cursor + stride])
        cursor += stride
        decoded = bytearray(stride)
        for index, value in enumerate(encoded):
            left = decoded[index - 4] if index >= 4 else 0
            up = previous[index]
            upper_left = previous[index - 4] if index >= 4 else 0
            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = up
            elif filter_type == 3:
                predictor = (left + up) // 2
            elif filter_type == 4:
                estimate = left + up - upper_left
                distances = (abs(estimate - left), abs(estimate - up), abs(estimate - upper_left))
                predictor = (left, up, upper_left)[distances.index(min(distances))]
            else:
                raise ValueError(f"Unsupported PNG filter {filter_type}: {path}")
            decoded[index] = (value + predictor) & 0xFF
        rows.append(bytes(decoded))
        previous = decoded
    return width, height, rows


def write_rgba_png(path: Path, width: int, height: int, rows: list[bytes]) -> None:
    signature = b"\x89PNG\r\n\x1a\n"

    def chunk(kind: bytes, payload: bytes) -> bytes:
        checksum = struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        return struct.pack(">I", len(payload)) + kind + payload + checksum

    scanlines = b"".join(b"\x00" + row for row in rows)
    payload = signature
    payload += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    payload += chunk(b"IDAT", zlib.compress(scanlines, level=9))
    payload += chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def crop_png(source: Path, target: Path, width: int, height: int) -> None:
    source_width, source_height, rows = decode_rgba_png(source)
    if source_width < width or source_height < height:
        raise ValueError(f"Cannot crop {source} to {width}x{height}")
    cropped = [row[: width * 4] for row in rows[:height]]
    write_rgba_png(target, width, height, cropped)


def enclosed_transparent_components(path: Path) -> int:
    width, height, rows = decode_rgba_png(path)
    transparent = [rows[y][x * 4 + 3] < 128 for y in range(height) for x in range(width)]
    visited = [False] * (width * height)
    enclosed = 0
    for start, enabled in enumerate(transparent):
        if not enabled or visited[start]:
            continue
        stack = [start]
        visited[start] = True
        touches_edge = False
        count = 0
        while stack:
            index = stack.pop()
            y, x = divmod(index, width)
            count += 1
            touches_edge |= x in (0, width - 1) or y in (0, height - 1)
            for neighbor in (index - 1, index + 1, index - width, index + width):
                if not 0 <= neighbor < width * height:
                    continue
                neighbor_y, neighbor_x = divmod(neighbor, width)
                if abs(neighbor_x - x) + abs(neighbor_y - y) != 1:
                    continue
                if transparent[neighbor] and not visited[neighbor]:
                    visited[neighbor] = True
                    stack.append(neighbor)
        if not touches_edge and count:
            enclosed += 1
    return enclosed


def validate_assets() -> None:
    for name, expected in svg_assets().items():
        path = BRAND / name
        ElementTree.parse(path)
        text = path.read_text()
        if text != expected:
            raise ValueError(f"Generated SVG is stale: {path}")
        if re.search(r'(?:href|src)="https?://', text):
            raise ValueError(f"External reference in {path}")

    for size in MARK_SIZES:
        for polarity in ("", "-reversed"):
            path = PNG_DIR / f"claude-prompts-mark{polarity}-{size}.png"
            if png_dimensions(path) != (size, size):
                raise ValueError(f"Unexpected dimensions: {path}")

    declared = {
        BRAND / "claude-prompts-avatar-500.png": (500, 500),
        BRAND / "claude-prompts-icon-512.png": (512, 512),
        BRAND / "claude-prompts-social-preview-1280x640.png": (1280, 640),
        ROOT / "assets" / "logo.png": (512, 512),
        ROOT / "assets" / "icon-512.png": (512, 512),
    }
    for path, dimensions in declared.items():
        if png_dimensions(path) != dimensions:
            raise ValueError(f"Unexpected dimensions: {path}")

    social_preview = BRAND / "claude-prompts-social-preview-1280x640.png"
    if social_preview.stat().st_size >= 1_000_000:
        raise ValueError("GitHub social preview must remain below 1 MB")

    for name in ("claude-prompts-mark-16.png", "claude-prompts-mark-reversed-16.png"):
        path = PNG_DIR / name
        if enclosed_transparent_components(path) < 2:
            raise ValueError(f"Micro counters did not survive as enclosed regions: {path}")
        _, _, rows = decode_rgba_png(path)
        near_eye = rows[6][5 * 4 + 3]
        separation = rows[6][6 * 4 + 3]
        far_eye = rows[6][8 * 4 + 3]
        if not (near_eye < 64 and far_eye < 128 and separation > 128):
            raise ValueError(f"Both micro eyes must remain visible and separated: {path}")

    print("brand assets: PASS")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Validate existing assets without rendering")
    arguments = parser.parse_args()
    if not arguments.check:
        write_svg_assets()
        render_png_assets()
    validate_assets()


if __name__ == "__main__":
    main()
