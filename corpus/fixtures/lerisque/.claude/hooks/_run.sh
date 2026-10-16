#!/bin/sh
# Portable launcher for the repository's Claude Code hooks.
#
# WHY THIS EXISTS
# ---------------
# `.claude/settings.json` used to invoke each hook as bare `python3`. That is
# wrong on both platforms this team actually uses:
#
#   macOS   On a stock Mac, `python3` is Apple's SIP-protected 3.9.6. uv
#           installs only VERSIONED names (`python3.14`), and whether a Homebrew
#           Python also provides a bare `python3` depends on the formula.
#   Windows Claude Code runs hooks through Git Bash. Python from python.org
#           ships `python.exe` and `py.exe` — not `python3`. Worse, Windows
#           ships an App Execution Alias stub named `python3.exe` that opens the
#           Microsoft Store instead of running anything.
#
# A missing interpreter exits 127, and Claude Code treats any PreToolUse exit
# other than 2 as non-blocking — so the tool call proceeds. The guardrails do
# not fail loudly; they fail *silently and open*. That is the defect this
# launcher closes.
#
# CONTRACT
#   usage: sh _run.sh <hook-file.py>
#   - stdin (the hook JSON payload) is passed straight through via exec
#   - the hook's exit code is propagated unchanged, so `exit 2` still blocks
#   - no interpreter found  -> exit 1 (non-blocking, but SURFACED to the user)
#
# Exit 1 rather than 0 is deliberate. Exit 0 is what made this invisible for
# months. Exit 1 is reported without blocking work — loud, not fatal. Exit 2 is
# reserved for a hook's own policy decision and must never be produced here: a
# broken launcher must not brick every tool call in the session.
#
# Escape hatch: set CLAUDE_HOOK_PYTHON to an absolute interpreter path to skip
# discovery entirely.

set -u

hook_name="${1:-}"
if [ -z "$hook_name" ]; then
    echo "_run.sh: no hook name given (usage: sh _run.sh <hook-file.py>)" >&2
    exit 1
fi

# Derive the directory with parameter expansion, not `dirname`. `dirname` is an
# external binary, so a broken or empty PATH makes this step fail and the script
# then reports a misleading "hook not found" instead of the real cause. Shell
# builtins keep the diagnostic honest no matter how degraded the environment is.
case "$0" in
    */*) hook_dir=${0%/*} ;;
    *)   hook_dir=. ;;
esac
hook="$hook_dir/$hook_name"
if [ ! -f "$hook" ]; then
    echo "_run.sh: hook not found: $hook" >&2
    exit 1
fi

# Accept an interpreter only if it is importable AND >= 3.9 (the floor the
# hooks support). This also rejects the Windows Store stub, which cannot run -c.
usable() {
    "$@" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' \
        >/dev/null 2>&1
}

if [ -n "${CLAUDE_HOOK_PYTHON:-}" ]; then
    if usable "$CLAUDE_HOOK_PYTHON"; then
        exec "$CLAUDE_HOOK_PYTHON" "$hook"
    fi
    # Set but unusable — a typo, or a path that moved. Falling through to
    # discovery silently would mean the pin quietly stopped applying and a
    # different interpreter ran, which for py-syntax-check.py decides whether
    # valid source is reported as a syntax error. Say so; then continue, since
    # running a discovered interpreter still beats not running the hook.
    echo "_run.sh: CLAUDE_HOOK_PYTHON='$CLAUDE_HOOK_PYTHON' is not a usable Python 3.9+; ignoring it and falling back to PATH discovery." >&2
fi

# Newest first, deliberately. 3.9 is the floor the hooks SUPPORT, not the
# version they should preferentially run under: `py-syntax-check.py` compiles
# project source with whatever interpreter wins here, and the backend targets
# the minor pinned in `.python-version`. Picking a stock macOS 3.9.6 ahead of
# an installed 3.14 would report valid modern syntax as an error and hand that
# back to Claude as "fix this" — a corrupting failure, not merely a permissive
# one. `command -v` is a shell builtin, so ranking candidates costs nothing;
# only the winner is probed.
#
# On Git Bash prefer the `py` launcher: it resolves a real installation and
# sidesteps the Store-alias `python3.exe`, which cannot execute `-c` at all.
case "$(uname -s 2>/dev/null || echo unknown)" in
    MINGW* | MSYS* | CYGWIN*)
        candidates="py python3.14 python3.13 python3.12 python3.11 python3.10 python python3"
        ;;
    *)
        candidates="python3.14 python3.13 python3.12 python3.11 python3.10 python3 python"
        ;;
esac

for candidate in $candidates; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    if [ "$candidate" = "py" ]; then
        if usable py -3; then
            exec py -3 "$hook"
        fi
    elif usable "$candidate"; then
        exec "$candidate" "$hook"
    fi
done

# One line: on exit 1 only the first stderr line reliably reaches the
# transcript, so it has to carry the hook name and the consequence by itself.
echo "_run.sh: '$hook_name' DID NOT RUN — no Python 3.9+ on PATH, so this repository's guardrails are NOT being enforced. Install Python 3.9+, or set CLAUDE_HOOK_PYTHON to an absolute interpreter path. See CLAUDE.md > Hooks." >&2
exit 1
