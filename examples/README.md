# Examples — hands-on demo & sample registry

Everything you need to demo `ai-workspace` to your team.

- **`registry/`** — a sample shared catalog (agents, rules, prompts, an MCP server,
  two packs, and a skill). This is what a team curates.
- **`demo.sh`** — a narrated, paced walkthrough that drives a throwaway project through
  the whole flow.

## Run the demo

From the repo root:

```bash
npm install            # once
bash examples/demo.sh  # paced — pauses between steps so you can talk
```

Prefer it to run straight through (no pauses)?

```bash
NOPAUSE=1 bash examples/demo.sh
```

The script builds the CLI, uses `examples/registry` as the catalog, and walks through:
`init → search → add (pack + skill) → generate → idempotent re-run → edit-preservation →
clean uninstall`. It only writes to a temp directory — your repo stays untouched.

## What the demo shows

| Step | Point to make to the team |
|---|---|
| `search` | one shared catalog everyone browses |
| `add pack:frontend-team skill:code-review` | install à la carte **or** by curated pack |
| `generate` | one source → files for **every** AI tool, with honest "notices" |
| dependency pull | `tailwind` arrives automatically as `react-expert`'s dependency |
| re-run | idempotent — safe to run anytime |
| hand-edit → generate | **your edits are kept** |
| `remove` → generate | precise clean uninstall (only what the pack created) |

## Turn this into your real, Git-hosted registry

The demo uses a local folder. To make it the team's actual shared catalog:

```bash
# 1. Copy the sample as a starting point for a NEW repo
cp -r examples/registry /path/to/ai-registry
cd /path/to/ai-registry
git init -b main && git add -A && git commit -m "Initial catalog"

# 2. Create an empty PRIVATE repo on github.com/new, then:
git remote add origin git@github.com:YOUR_ORG/ai-registry.git
git push -u origin main
```

Then point any project at it in `.ai/workspace.json`:

```jsonc
"registry": { "url": "git@github.com:YOUR_ORG/ai-registry.git", "ref": "main" }
```

`ai-workspace add … / generate` will clone it into `.ai/cache/registry/` and build from it.

## Add your own artifacts to the catalog

Just drop files in the right folder — no code:

```
registry/
  agents/<id>.md      # frontmatter: name, description, model, tools, dependencies
  rules/<id>.md       # frontmatter: title, globs
  prompts/<id>.md     # frontmatter: name, description
  mcp/<id>.json       # { name, transport, command/args or url }
  skills/<id>/SKILL.md  (+ scripts/, references/…)   # a folder, per the SKILL.md standard
  packs/<id>.yaml     # { description, use: [ "agent:x", "rule:y", "pack:z" ] }
```
