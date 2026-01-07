#!/usr/bin/env python3
"""
SessionStart hook: Auto-sync plugin source to Gemini CLI extension cache.

Uses quick-check mode: compares source timestamps against last sync marker.
Skips sync if no changes detected (<100ms). Full sync only when needed (2-5s).

Only syncs if running from separate source (not marketplace install).
"""

import os
import shutil
import sys
from pathlib import Path

# Directories to sync and check for changes
SYNC_DIRS = [".gemini"]
SYNC_SERVER_SUBDIRS = ["cache", "dist"]
MARKER_FILE = ".dev-sync-marker"


def get_source_mtime(source_dir: Path) -> float:
    """Get latest modification time from source directories.

    Scans all files in sync directories to find the most recent change.
    Returns 0.0 if no files found.
    """
    latest = 0.0

    # Check core directories
    for dir_name in SYNC_DIRS:
        src = source_dir / dir_name
        if src.exists():
            for f in src.rglob("*"):
                if f.is_file():
                    try:
                        latest = max(latest, f.stat().st_mtime)
                    except OSError:
                        pass  # Skip files we can't stat

    # Check server subdirectories
    for subdir in SYNC_SERVER_SUBDIRS:
        src = source_dir / f"server/{subdir}"
        if src.exists():
            for f in src.rglob("*"):
                if f.is_file():
                    try:
                        latest = max(latest, f.stat().st_mtime)
                    except OSError:
                        pass

    return latest


def get_sync_marker(cache_dir: Path) -> float:
    """Read last sync timestamp from marker file.

    Returns 0.0 if marker doesn't exist (forces full sync).
    """
    marker = cache_dir / MARKER_FILE
    if marker.exists():
        try:
            return float(marker.read_text().strip())
        except (ValueError, OSError):
            return 0.0
    return 0.0


def write_sync_marker(cache_dir: Path, mtime: float) -> None:
    """Write sync timestamp to marker file."""
    marker = cache_dir / MARKER_FILE
    try:
        marker.write_text(str(mtime))
    except OSError:
        pass  # Non-critical, will just sync again next time


def find_source_dir() -> Path | None:
    """Find the plugin source directory at known dev locations.

    Searches common development directories for claude-prompts-mcp.
    Returns None if not found (e.g., marketplace install).
    """
    # Check common dev locations across different OS conventions
    candidates = [
        # macOS/Linux common locations
        Path.home() / "Applications/claude-prompts-mcp",
        Path.home() / "projects/claude-prompts-mcp",
        Path.home() / "dev/claude-prompts-mcp",
        Path.home() / "src/claude-prompts-mcp",
        Path.home() / "code/claude-prompts-mcp",
        Path.home() / "repos/claude-prompts-mcp",
        Path.home() / "git/claude-prompts-mcp",
        Path.home() / "workspace/claude-prompts-mcp",
        # Windows common locations
        Path.home() / "Documents/claude-prompts-mcp",
        Path.home() / "Documents/GitHub/claude-prompts-mcp",
        # XDG conventions
        Path.home() / ".local/src/claude-prompts-mcp",
    ]

    for candidate in candidates:
        if (candidate / "server").exists() and (candidate / ".gemini").exists():
            return candidate

    return None


def find_cache_dir() -> Path | None:
    """Find the Gemini CLI extension cache directory.

    Searches for any extension containing 'prompts' in the name.
    """
    extensions_base = Path.home() / ".gemini/extensions"

    if not extensions_base.exists():
        return None

    # Search for prompts extension
    for ext_dir in extensions_base.iterdir():
        if ext_dir.is_dir() and "prompts" in ext_dir.name:
            return ext_dir

    return None


def sync_directory(src: Path, dst: Path) -> bool:
    """Sync a directory from source to destination."""
    if not src.exists():
        return False

    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    return True


def main():
    source_dir = find_source_dir()
    cache_dir = find_cache_dir()

    if not source_dir or not cache_dir:
        sys.exit(0)  # Silent exit if can't find directories (marketplace install)

    # Quick-check: compare source timestamps against last sync
    source_mtime = get_source_mtime(source_dir)
    last_sync = get_sync_marker(cache_dir)

    if source_mtime <= last_sync:
        sys.exit(0)  # No changes since last sync - fast exit (<100ms)

    # Changes detected - perform full sync
    synced = []

    # Sync core directories
    for dir_name in SYNC_DIRS:
        src = source_dir / dir_name
        dst = cache_dir / dir_name
        if sync_directory(src, dst):
            synced.append(dir_name)

    # Sync server subdirectories
    for server_subdir in SYNC_SERVER_SUBDIRS:
        src = source_dir / f"server/{server_subdir}"
        dst = cache_dir / f"server/{server_subdir}"
        if src.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            if sync_directory(src, dst):
                synced.append(f"server/{server_subdir}")

    # Update marker after successful sync
    if synced:
        write_sync_marker(cache_dir, source_mtime)
        print(f"[Dev Sync] {', '.join(synced)}")

    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # Silent failure - don't break session start
        sys.exit(0)
