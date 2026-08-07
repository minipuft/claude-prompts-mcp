"""
Workspace resolution for Claude Code hooks.

Priority:
  1. MCP_WORKSPACE - User-defined workspace location
  2. CLAUDE_PLUGIN_ROOT - Set by Claude Code plugin system (Codex CLI also
     provides it as a compatibility alias for plugin-bundled hooks)
  3. PLUGIN_ROOT - Codex CLI plugin system's native root variable
  4. GEMINI_EXTENSION_PATH / extensionPath - Gemini CLI extension root
  5. Self-resolution - Detect from script location (zero-config fallback)
"""

import os
from pathlib import Path


def get_workspace_root() -> Path | None:
    """
    Get the plugin workspace root directory.

    Priority:
      1. MCP_WORKSPACE env var (user-defined)
      2. CLAUDE_PLUGIN_ROOT env var (Claude Code plugin system; Codex alias)
      3. PLUGIN_ROOT env var (Codex CLI plugin system, native name)
      4. GEMINI_EXTENSION_PATH / extensionPath env var (Gemini CLI)
      5. Self-resolution from script location (fallback)
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

    # 3. Codex CLI plugin root (PLUGIN_ROOT is the native name; the
    #    CLAUDE_PLUGIN_ROOT compatibility alias is already handled above)
    generic_plugin_root = os.environ.get("PLUGIN_ROOT")
    if generic_plugin_root:
        generic_plugin_path = Path(generic_plugin_root)
        if generic_plugin_path.exists():
            return generic_plugin_path

    # 4. Gemini CLI extension root
    gemini_root = os.environ.get("GEMINI_EXTENSION_PATH") or os.environ.get("extensionPath")
    if gemini_root:
        gemini_path = Path(gemini_root)
        if gemini_path.exists():
            return gemini_path

    # 5. Self-resolution from script location
    # Supports both:
    #   - hooks/lib/workspace.py (development: lib -> hooks -> project_root)
    #   - .claude-plugin/hooks/lib/workspace.py (packaged: lib -> hooks -> .claude-plugin -> project_root)
    script_dir = Path(__file__).resolve().parent  # lib/
    hooks_dir = script_dir.parent  # hooks/

    # Try development structure first (hooks at project root)
    project_root = hooks_dir.parent
    if (project_root / "server").exists():
        return project_root

    # Try packaged structure (.claude-plugin/hooks/)
    plugin_dir = hooks_dir.parent  # .claude-plugin/
    project_root = plugin_dir.parent
    if (project_root / "server").exists():
        return project_root

    return None


def get_server_dir(fallback: Path) -> Path:
    """Get the server directory (contains resources, config, etc.)."""
    workspace = get_workspace_root()
    if workspace:
        return workspace / "server"
    return fallback


def get_skills_dir(fallback: Path) -> Path:
    """Get the skills directory containing _index.json."""
    workspace = get_workspace_root()
    if workspace:
        return workspace / ".claude-plugin" / "skills"
    return fallback


def get_runtime_state_dir(fallback: Path) -> Path:
    """Get the runtime-state directory for transient state files."""
    workspace = get_workspace_root()
    if workspace:
        # MCP server writes to {workspace}/server/runtime-state/ (serverRoot = workspace/server)
        return workspace / "server" / "runtime-state"
    return fallback


def get_state_db_path() -> Path | None:
    """Get path to the MCP server's state.db (read-only from hooks)."""
    workspace = get_workspace_root()
    if workspace:
        db_path = workspace / "server" / "runtime-state" / "state.db"
        if db_path.exists():
            return db_path
    return None
