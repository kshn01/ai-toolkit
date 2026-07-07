# Provider Capability Matrix

The single most important design document in the project. It defines, for each
capability in the [canonical schema](../../packages/core/src/domain/schema/workspace.ts),
**whether** a provider can represent it and **how** the adapter projects it.

- **supported** — first-class, round-trippable, no information loss.
- **lossy** — representable, but something is dropped or approximated. Adapter **must** emit a diagnostic.
- **unsupported** — no representation. Adapter drops it and emits a diagnostic; never silent.

> ⚠️ **Verify before coding.** These paths/formats reflect best-known conventions as of
> early 2026. Provider config formats move fast. Each adapter's first task is to confirm
> its target paths against current vendor docs and pin the finding in a comment.

> **Implementation status.** ✅ **Claude Code** and **GitHub Copilot** are built —
> [claude.ts](../../packages/core/src/providers/claude.ts) /
> [copilot.ts](../../packages/core/src/providers/copilot.ts) — and their columns below
> match the code. 🔲 **Cursor, Gemini, Codex** are design targets, not yet implemented;
> their rows are the plan for when each adapter is written.

## Matrix

| Capability | Cursor 🔲 | Claude Code ✅ | Copilot ✅ | Gemini CLI 🔲 | Codex 🔲 |
|---|---|---|---|---|---|
| **instruction** | supported | supported | supported | supported | supported |
| **rule** (glob-scoped) | supported | lossy | supported | lossy | lossy |
| **agent** (subagent) | unsupported | supported | unsupported | unsupported | unsupported |
| **command** (slash/prompt) | lossy | supported | supported | supported | supported |
| **mcp** | supported | supported | lossy | supported | lossy |
| **skill** (`SKILL.md` folder) | tbd | supported | supported | tbd | tbd |

> **Skills are an open, cross-tool standard.** A skill is a *folder* — `SKILL.md` plus
> optional `references/`, `scripts/`, `templates/`, `assets/`. Claude Code reads
> `.claude/skills/<name>/`; Copilot reads `.github/skills/`, `.claude/skills/`, or
> `.agents/skills/`. Because the format is shared (like `AGENTS.md` for instructions),
> a skill projects to both with **no loss** — the only per-provider difference is the
> target directory. Skill ≠ agent: Copilot has skills but not subagents. `tbd` = confirm
> when that adapter is built.

## Target paths & projection rules

### Cursor
| Capability | Target | Rule |
|---|---|---|
| instruction | `.cursor/rules/<id>.mdc` | frontmatter `alwaysApply: true`, empty `globs`. |
| rule | `.cursor/rules/<id>.mdc` | frontmatter `description`, `globs`, `alwaysApply`. Native — 1:1. |
| agent | — | **unsupported.** Drop + diagnostic. (Option flag: inline as an alwaysApply rule prefixed "Persona: …".) |
| command | `.cursor/commands/<id>.md` (verify) | **lossy** — no `argumentHint` concept; drop the hint, keep body. |
| mcp | `.cursor/mcp.json` | merge into `mcpServers` map. Native. |

### Claude Code
| Capability | Target | Rule |
|---|---|---|
| instruction | `CLAUDE.md` | rendered inside a managed region, ordered by `priority`. |
| rule | `CLAUDE.md` (or nested `<dir>/CLAUDE.md`) | **lossy** — Claude has no auto-glob activation. Emit globs as a "Applies to: `<globs>`" note; if a rule's globs map cleanly to one directory, prefer a nested `CLAUDE.md`. |
| agent | `.claude/agents/<id>.md` | frontmatter `name`/`description`/`model`/`tools`. `ModelTier` → concrete model id via adapter map. Native. |
| command | `.claude/commands/<id>.md` | frontmatter `description`/`argument-hint`. Native. |
| mcp | `.mcp.json` | merge into `mcpServers`. Native. |
| skill | `.claude/skills/<id>/…` | copy the whole skill folder verbatim (SKILL.md + resources). Native. |

### GitHub Copilot
| Capability | Target | Rule |
|---|---|---|
| instruction | `.github/copilot-instructions.md` | managed region, ordered by `priority`. |
| rule | `.github/instructions/<id>.instructions.md` | frontmatter `applyTo: "<glob>"`. Native (single glob — join multiple with `,`). |
| agent | — | **unsupported.** Drop + diagnostic. |
| command | `.github/prompts/<id>.prompt.md` | prompt file. Native-ish. |
| mcp | — (not generated) | **lossy** — editor-scoped config isn't repo-portable, so the adapter emits a diagnostic and generates nothing rather than write a misleading file. |
| skill | `.github/skills/<id>/…` | copy the whole skill folder verbatim. Native (Copilot also reads `.claude/skills`). |

### Gemini CLI
| Capability | Target | Rule |
|---|---|---|
| instruction | `GEMINI.md` | managed region, ordered by `priority`. |
| rule | `GEMINI.md` / nested `GEMINI.md` | **lossy** — same as Claude; no glob activation. Emit "Applies to" note. |
| agent | — | **unsupported.** Drop + diagnostic. |
| command | `.gemini/commands/<id>.toml` | TOML custom command (`prompt = """…"""`). Native. |
| mcp | `.gemini/settings.json` | merge into `mcpServers`. Native. |

### Codex
| Capability | Target | Rule |
|---|---|---|
| instruction | `AGENTS.md` | managed region, ordered by `priority`. |
| rule | `AGENTS.md` / nested `AGENTS.md` | **lossy** — no glob activation; nested files for dir-scoped rules. |
| agent | — | **unsupported.** `AGENTS.md` is instructions, not subagents. Drop + diagnostic. |
| command | `.codex/prompts/<id>.md` (verify) | custom prompt. Native-ish. |
| mcp | `.codex/config.toml` / project config (verify) | **lossy** — TOML shape differs; validate mapping. |

## Two strategic reads

1. **`agent` is the sharpest capability cliff.** Only Claude Code has first-class
   subagents today. If subagents are central to your value prop, decide the default
   projection for the other four (drop vs. inline-as-instruction) — it's a product
   decision, not a technical one. Expose it as a flag; default to **drop + loud diagnostic**.

2. **The `AGENTS.md` convergence.** Codex, and increasingly others, read `AGENTS.md`.
   Claude reads `CLAUDE.md`, Gemini `GEMINI.md`. These are the same capability
   (instruction) with different filenames. Your canonical `instruction` already models
   this correctly — the divergence is purely at the adapter's target-path layer, which
   is exactly where it should live. If the ecosystem standardizes on `AGENTS.md`, only
   target paths change; the canonical model does not. That's the extensibility proof.

## How the matrix is used at runtime

```
resolve(manifest) -> CanonicalWorkspace
  for each provider in workspace.providers:
    adapter = registry.get(provider)
    for each capability present in the workspace:
      level = adapter.capabilities[capability]
      if level === 'unsupported' -> record Diagnostic(drop)
      if level === 'lossy'       -> record Diagnostic(approximate)
    plan = adapter.plan(workspace)   // pure: model -> GenerationPlan
  aggregate diagnostics -> show BEFORE writing (doctor / dry-run)
  execute plans through the shared merge engine (lockfile + 3-way)
```

Diagnostics surface in `doctor` and in a pre-write summary so the user sees *what
won't survive the projection* before any file is touched.
