#!/usr/bin/env python3
"""Assert `.claude/settings.json` actually wires every hook, through the launcher.

Run directly (exit 0 = wired correctly, 1 = a violation, printed to stderr):

    python3 .claude/tests/_assert_hook_wiring.py

WHY THIS EXISTS
---------------
The wiring file was the ENTIRE original defect: every hook was invoked as bare
`python3`, which on macOS is Apple's 3.9.6, and each hook then self-disabled and
exited 0 — so all eight guardrails were silently inert for months. Yet nothing
read `settings.json`. The 171-case suite spawns hooks directly with
`sys.executable`, so the defect could be reintroduced in full — reverting every
command back to bare `python3`, or dropping a hook from the file entirely — with
the suite staying green.

A test that exercises hooks but never checks they are *connected* measures the
wrong thing. These four invariants are what "the guardrails are on" means:

1. Every hook implementation in `.claude/hooks/` is wired to at least one event.
   Catches a hook added but never connected — present, tested, and never run.
2. Every wired command goes through `_run.sh`. Catches a regression to bare
   `python3`, which is the original defect verbatim.
3. Every wired hook file exists. Catches a rename that leaves a dangling entry;
   the launcher would exit 1 forever and only stderr would say so.
4. `settings.json` is valid JSON. A malformed file disables every hook at once.

Files starting with `_` are shared helpers (`_run.sh`, `_shell_lex.py`), not
hooks, and are deliberately exempt from invariant 1.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
HOOKS_DIR = REPO_ROOT / ".claude" / "hooks"
SETTINGS = REPO_ROOT / ".claude" / "settings.json"
LAUNCHER_MARKER = "_run.sh"


def main() -> int:
    problems: list[str] = []

    try:
        settings = json.loads(SETTINGS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"settings.json is unreadable or invalid JSON: {exc}\n")
        return 1

    wired: dict[str, str] = {}
    for event, entries in (settings.get("hooks") or {}).items():
        for entry in entries:
            for hook in entry.get("hooks", []):
                command = hook.get("command", "")
                if ".claude/hooks/" not in command:
                    continue
                name = command.rsplit(" ", 1)[-1].strip('"').split("/")[-1]
                wired[name] = command
                if LAUNCHER_MARKER not in command:
                    problems.append(
                        f"[{event}] {name} is not launched through {LAUNCHER_MARKER}: {command!r}. "
                        "Invoking an interpreter directly is the original defect — on a stock "
                        "macOS that resolves to 3.9.6 and the hook silently no-ops."
                    )
                if not (HOOKS_DIR / name).is_file():
                    problems.append(f"[{event}] wired hook {name} does not exist in {HOOKS_DIR}")

    implemented = {
        p.name for p in HOOKS_DIR.glob("*.py") if not p.name.startswith("_")
    }
    for name in sorted(implemented - set(wired)):
        problems.append(
            f"{name} exists in .claude/hooks/ but is wired to no event in settings.json — "
            "it will never run."
        )

    if problems:
        sys.stderr.write("hook wiring violations:\n")
        for problem in problems:
            sys.stderr.write(f"  - {problem}\n")
        return 1

    print(f"hook wiring OK: {len(wired)} hook(s) wired, all through {LAUNCHER_MARKER}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
