#!/usr/bin/env python3
"""
Parses skills/_index.json and detects relevant skills for current project.
Outputs available skills for SessionStart hook.
"""

import json
import fnmatch
import sys
from pathlib import Path

# Add hooks lib to path
sys.path.insert(0, str(Path(__file__).parent / "lib"))

from workspace import get_skills_dir


def get_skills_index_path() -> Path:
    """
    Get path to skills index.

    Priority:
      1. MCP_WORKSPACE/skills/_index.json
      2. CLAUDE_PLUGIN_ROOT/skills/_index.json
      3. ~/.claude/skills/_index.json (user fallback)
    """
    # Check workspace-based skills dir first
    user_fallback = Path.home() / ".claude" / "skills"
    skills_dir = get_skills_dir(user_fallback)
    skills_index = skills_dir / "_index.json"

    if skills_index.exists():
        return skills_index

    # Fall back to user's ~/.claude/skills
    return user_fallback / "_index.json"


def load_index():
    """Load skills index from detected path."""
    index_path = get_skills_index_path()
    if not index_path.exists():
        return {"skills": {}}
    with open(index_path) as f:
        return json.load(f)


def check_package_json(packages_to_match):
    """Check if any packages match in package.json dependencies."""
    pkg_path = Path("package.json")
    if not pkg_path.exists():
        return []

    try:
        with open(pkg_path) as f:
            pkg = json.load(f)

        all_deps = set()
        for key in ["dependencies", "devDependencies", "peerDependencies"]:
            all_deps.update(pkg.get(key, {}).keys())

        matched = []
        for pattern in packages_to_match:
            if "*" in pattern:
                for dep in all_deps:
                    if fnmatch.fnmatch(dep, pattern):
                        matched.append(dep)
            elif pattern in all_deps:
                matched.append(pattern)
        return matched
    except (json.JSONDecodeError, IOError):
        return []


def detect_skills(index):
    """Detect which skills are relevant for current project."""
    cwd = Path.cwd()
    cwd_name = cwd.name
    detected = []

    for skill_name, config in index.get("skills", {}).items():
        reasons = []

        # Check project markers (files that indicate project type)
        for marker in config.get("projectMarkers", []):
            if (cwd / marker).exists():
                reasons.append(f"{marker} present")

        # Check directory patterns
        for pattern in config.get("directoryPatterns", []):
            if fnmatch.fnmatch(cwd_name, pattern):
                reasons.append(f"directory matches {pattern}")

        # Check packages
        matched_pkgs = check_package_json(config.get("packages", []))
        if matched_pkgs:
            reasons.append(f"packages: {', '.join(matched_pkgs[:3])}")

        if reasons:
            detected.append({
                "skill": skill_name,
                "reasons": reasons,
                "hint": config.get("hint", f"Use /{skill_name}")
            })

    return detected


def main():
    index = load_index()
    detected = detect_skills(index)

    # Output to stdout with exit 0 for transcript visibility
    if detected:
        skills = [d["skill"] for d in detected]
        output = f"[Skills] {', '.join(skills)}"
    else:
        all_skills = sorted(index.get("skills", {}).keys())
        output = f"[Skills] {', '.join(all_skills)}"

    print(output)  # stdout, visible in transcript
    sys.exit(0)


if __name__ == "__main__":
    main()
