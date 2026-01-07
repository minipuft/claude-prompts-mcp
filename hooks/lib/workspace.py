"""
Workspace resolution for Claude Code hooks.

Priority:
  1. MCP_WORKSPACE - User-defined workspace location
  2. CLAUDE_PLUGIN_ROOT - Set by Claude Code plugin system
  3. Self-resolution - Detect from script location (zero-config fallback)
"""

import os
from pathlib import Path


def get_workspace_root() -> Path | None:
    """
    Get the plugin workspace root directory.

    Priority:
      1. MCP_WORKSPACE env var (user-defined)
      2. CLAUDE_PLUGIN_ROOT env var (set by Claude Code plugin system)
      3. Self-resolution from script location (fallback)
    """
    # 1. User-defined workspace (highest priority)
    mcp_workspace = os.environ.get("MCP_WORKSPACE")
    if mcp_workspace:
        workspace_path = Path(mcp_workspace)
        if workspace_path.exists():
            return workspace_path

    # 2. Claude Code plugin root (set by plugin system)
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if plugin_root:
        plugin_path = Path(plugin_root)
        if plugin_path.exists():
            return plugin_path

    # 3. Gemini CLI extension root
    gemini_root = os.environ.get("GEMINI_EXTENSION_PATH") or os.environ.get("extensionPath")
    if gemini_root:
        gemini_path = Path(gemini_root)
        if gemini_path.exists():
            return gemini_path

    # 4. Self-resolution from script location
    # .claude-plugin/hooks/lib/workspace.py -> lib -> hooks -> .claude-plugin -> project_root
    script_dir = Path(__file__).resolve().parent
    plugin_dir = script_dir.parent.parent  # .claude-plugin
    project_root = plugin_dir.parent       # repo root
    if (project_root / "server").exists():
        return project_root

    return None


def get_server_dir(fallback: Path) -> Path:
    """Get the server directory (contains cache, resources, etc.)."""
    workspace = get_workspace_root()
    if workspace:
        return workspace / "server"
    return fallback


def get_cache_dir(fallback: Path) -> Path:
    """Get the cache directory for prompt/gate caches."""
    workspace = get_workspace_root()
    if workspace:
        return workspace / "server" / "cache"
    return fallback


def get_skills_dir(fallback: Path) -> Path:
    """Get the skills directory containing _index.json."""
    workspace = get_workspace_root()
    if workspace:
        return workspace / ".claude-plugin" / "skills"
    return fallback
