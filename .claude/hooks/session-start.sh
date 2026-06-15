#!/bin/bash
# SessionStart hook: make the GitHub CLI (gh) available in Claude Code on the web.
#   - installs gh if it is missing (idempotent)
#   - relies on $GH_TOKEN for auth (gh picks it up automatically) and wires it
#     into git so push / PR operations work over HTTPS
# Set GH_TOKEN in the environment's variable settings (web UI) to enable auth.
set -euo pipefail

# Only run in Claude Code on the web (remote) sessions; no-op locally.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# 1. Ensure gh is installed (idempotent; container state is cached after this runs).
if ! command -v gh >/dev/null 2>&1; then
  echo "session-start: installing GitHub CLI (gh)…"
  apt-get install -y gh >/dev/null 2>&1 \
    || { apt-get update >/dev/null 2>&1 && apt-get install -y gh >/dev/null 2>&1; } \
    || echo "session-start: WARNING — failed to install gh"
fi

# 2. Authenticate. gh automatically uses $GH_TOKEN when present.
if [ -n "${GH_TOKEN:-}" ]; then
  gh auth setup-git >/dev/null 2>&1 || true   # let git push/pull over HTTPS use the token
  who="$(gh api user -q .login 2>/dev/null || echo unknown)"
  echo "session-start: gh ready, authenticated as ${who}."
else
  echo "session-start: gh installed but GH_TOKEN is unset — add it in the environment's"
  echo "session-start: variable settings to enable push / PR from web sessions."
fi
