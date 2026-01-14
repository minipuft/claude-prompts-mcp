#!/usr/bin/env python3
"""
SessionStart hook: Auto-sync plugin source to Claude Code cache.

Uses quick-check mode: compares source timestamps against last sync marker.
Skips sync if no changes detected (<100ms). Full sync only when needed (2-5s).

Note: node_modules repair logic removed - bundled distribution is self-contained.

Only syncs if running from separate resources source (not marketplace install).
"""

import shutil
import sys
from pathlib import Path

# Directories to sync and check for changes
SYNC_DIRS = [".claude-plugin", "hooks", "skills"]
SYNC_SERVER_SUBDIRS = ["cache", "dist", "resources"]
SYNC_ROOT_FILES = [".mcp.json"]
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

    # Check root-level files
    for filename in SYNC_ROOT_FILES:
        src = source_dir / filename
        if src.exists():
            try:
                latest = max(latest, src.stat().st_mtime)
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

    Searches common development directories for claude-prompts.
    Returns None if not found (e.g., marketplace install).
    """
    # Check common dev locations across different OS conventions
    candidates = [
        # macOS/Linux common locations
        Path.home() / "Applications/claude-prompts",
        Path.home() / "projects/claude-prompts",
        Path.home() / "dev/claude-prompts",
        Path.home() / "src/claude-prompts",
        Path.home() / "code/claude-prompts",
        Path.home() / "repos/claude-prompts",
        Path.home() / "git/claude-prompts",
        Path.home() / "workspace/claude-prompts",
        # Windows common locations
        Path.home() / "Documents/claude-prompts",
        Path.home() / "Documents/GitHub/claude-prompts",
        # XDG conventions
        Path.home() / ".local/src/claude-prompts",
    ]

    for candidate in candidates:
        if (candidate / "server").exists() and (candidate / ".claude-plugin").exists():
            return candidate

    return None


def find_cache_dir() -> Path | None:
    """Find the Claude Code plugin cache directory.

    Searches for any publisher's cache containing 'claude-prompts'.
    """
    cache_base = Path.home() / ".claude/plugins/cache"

    if not cache_base.exists():
        return None

    # Search all publishers for claude-prompts plugin
    for publisher_dir in cache_base.iterdir():
        if not publisher_dir.is_dir():
            continue
        for plugin_dir in publisher_dir.iterdir():
            if "claude-prompts" in plugin_dir.name and plugin_dir.is_dir():
                # Get the first version directory
                versions = [v for v in plugin_dir.iterdir() if v.is_dir()]
                if versions:
                    return versions[0]

    return None


def sync_directory(src: Path, dst: Path) -> bool:
    """Sync a directory from source to destination."""
    if not src.exists():
        return False

    try:
        if dst.exists():
            shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(src, dst, dirs_exist_ok=True)
        return True
    except (OSError, shutil.Error) as e:
        # Handle race conditions, permission issues, or file-in-use errors
        print(f"Warning: Sync {src.name} failed: {e}", file=sys.stderr)
        return False


def main():
    source_dir = find_source_dir()
    cache_dir = find_cache_dir()

    if not cache_dir:
        sys.exit(0)  # Silent exit if no cache (not installed)

    if not source_dir:
        sys.exit(0)  # No source dir means marketplace install - skip sync

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

    # Sync root-level files
    for filename in SYNC_ROOT_FILES:
        src = source_dir / filename
        dst = cache_dir / filename
        if src.exists():
            try:
                shutil.copy2(src, dst)
                synced.append(filename)
            except (OSError, shutil.Error):
                pass

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
