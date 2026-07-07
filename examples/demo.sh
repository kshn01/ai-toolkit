#!/usr/bin/env bash
#
# Hands-on demo of ai-workspace for a team walkthrough.
#
#   bash examples/demo.sh            # paced — pauses between steps (good for presenting)
#   NOPAUSE=1 bash examples/demo.sh  # run straight through (no pauses)
#
# It builds the CLI, uses examples/registry as the shared catalog, and drives a throwaway
# workspace through the full flow: init -> search -> add -> generate -> edit -> remove.
# Nothing outside a temp directory is touched.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export REGISTRY="$ROOT/examples/registry"
export WS="$(mktemp -d)/demo-project"
mkdir -p "$WS"

# colors
B=$'\033[1m'; C=$'\033[1;36m'; G=$'\033[1;32m'; D=$'\033[2m'; R=$'\033[0m'

say()   { printf "\n%s\n" "${C}━━ $* ${R}"; }
note()  { printf "%s\n" "${D}$*${R}"; }
pause() { [ "${NOPAUSE:-}" = "1" ] && return 0; printf "%s" "${D}   ↵ press Enter…${R}"; read -r _ || true; }

# Build once, then run the CLI like a real installed command.
say "Building the CLI (one time)…"
( cd "$ROOT" && npm run --silent build )
AIW=(node "$ROOT/dist/index.js")
aiw() { printf "%s\n" "${G}\$ ai-workspace $*${R}"; "${AIW[@]}" "$@" --cwd "$WS"; }

say "1. A developer initializes their project"
aiw init --yes
# Point the workspace at the shared catalog. In real life this is your Git URL, e.g.
#   "registry": { "url": "git@github.com:YOUR_ORG/ai-registry.git", "ref": "main" }
node -e '
  const f = process.env.WS + "/.ai/workspace.json";
  const j = JSON.parse(require("fs").readFileSync(f));
  j.registry = { url: process.env.REGISTRY, ref: "main" };
  j.agents = []; j.rules = []; j.commands = []; j.mcp = [];
  j.instructions = [{ id: "house-style", title: "House Style", body: "Write small, well-tested functions.", priority: 10 }];
  require("fs").writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
'
note "   → configured registry to point at the shared catalog"
pause

say "2. Browse the shared catalog"
aiw search ""
pause

say "3. Install a curated pack + a skill (one command)"
aiw add pack:frontend-team skill:code-review
pause

say "4. Generate — project into every configured AI tool"
aiw generate
note "   note: 'rule:typescript' + 'react-expert' came from the pack;"
note "         'tailwind' rode along as react-expert's dependency."
pause

say "5. See what was created"
( cd "$WS" && find . -type f -not -path './.ai/*' | sort | sed 's/^/   /' )
pause

say "6. Re-run is idempotent — nothing changes"
aiw generate
pause

say "7. Your hand-edits are preserved"
printf '\n<!-- team note: run the full test suite before pushing -->\n' >> "$WS/CLAUDE.md"
note "   (appended a personal note to CLAUDE.md, then re-generate)"
aiw generate
grep -q "team note" "$WS/CLAUDE.md" && printf "%s\n" "${G}   ✓ your note survived${R}"
pause

say "8. Clean uninstall — remove the pack"
aiw remove pack:frontend-team
aiw generate
note "   → exactly the pack's files (and its tailwind dependency) were removed;"
note "     the separately-installed skill stayed."
pause

say "Done. Explore the generated workspace:"
printf "%s\n" "${B}   $WS${R}"
