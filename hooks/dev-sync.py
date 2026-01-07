#!/usr/bin/env python3
"""
SessionStart hook: Auto-sync plugin source to Claude Code cache.

Uses quick-check mode: compares source timestamps against last sync marker.
Skips sync if no changes detected (<100ms). Full sync only when needed (2-5s).

Also ensures node_modules exists in cache (runs npm install if missing).

Only syncs if running from separate resources source (not marketplace install).
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

# Directories to sync and check for changes
SYNC_DIRS = [".claude-plugin", "hooks"]
SYNC_SERVER_SUBDIRS = ["cache", "dist"]
MARKER_FILE = ".dev-sync-marker"

# Critical packages that must exist for server to run
CRITICAL_PACKAGES = ["@modelcontextprotocol"]


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

    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    return True


def check_node_modules(cache_dir: Path) -> bool:
    """Check if node_modules exists and has critical packages.

    Returns True if healthy, False if repair needed.
    """
    node_modules = cache_dir / "server" / "node_modules"

    if not node_modules.exists():
        return False

    # Check for critical packages
    for pkg in CRITICAL_PACKAGES:
        if not (node_modules / pkg).exists():
            return False

    return True


def repair_node_modules(cache_dir: Path) -> bool:
    """Run npm install in the cache's server directory.

    Returns True if successful, False otherwise.
    """
    server_dir = cache_dir / "server"

    if not (server_dir / "package.json").exists():
        return False

    try:
        # Run npm install with minimal output
        result = subprocess.run(
            ["npm", "install", "--prefer-offline", "--no-audit", "--no-fund"],
            cwd=server_dir,
            capture_output=True,
            timeout=120,  # 2 minute timeout
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return False


def main():
    source_dir = find_source_dir()
    cache_dir = find_cache_dir()

    if not cache_dir:
        sys.exit(0)  # Silent exit if no cache (not installed)

    # Always check node_modules health (independent of sync)
    if not check_node_modules(cache_dir):
        print("[Dev Sync] Repairing node_modules...")
        if repair_node_modules(cache_dir):
            print("[Dev Sync] node_modules restored")
        else:
            print("[Dev Sync] Warning: node_modules repair failed")

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
