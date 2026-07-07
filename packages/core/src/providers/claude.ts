/**
 * Claude Code adapter. The richest target — it's the only provider with first-class
 * agents. Projects the full canonical model:
 *
 *   instructions + rules -> CLAUDE.md            (regions — user prose survives)
 *   agents               -> .claude/agents/*.md  (full)
 *   commands             -> .claude/commands/*.md (full)
 *   mcp                  -> .mcp.json             (structured merge)
 *
 * Rules are 'lossy' here: Claude has no automatic glob activation, so a rule is
 * rendered as an instruction carrying an "Applies to" note, and we emit a diagnostic.
 */

import type { Agent, CanonicalWorkspace, Command, ModelTier } from '../domain/schema/workspace.js';
import type { Diagnostic, PlanResult, PlannedRegion, PlannedWrite } from '../domain/schema/lockfile.js';
import type { ProviderAdapter } from './adapter.js';
import { byPriority, frontmatter, mcpConfig } from './shared.js';

const MODEL_MAP: Record<ModelTier, string | undefined> = {
  fast: 'claude-haiku-4-5',
  balanced: 'claude-sonnet-5',
  reasoning: 'claude-opus-4-8',
  default: undefined,
};

function renderAgent(a: Agent): string {
  const lines = [`name: ${a.name}`, `description: ${a.description}`];
  const model = MODEL_MAP[a.model];
  if (model) lines.push(`model: ${model}`);
  if (a.tools.length) lines.push(`tools: ${a.tools.join(', ')}`);
  return `${frontmatter(lines)}\n${a.body.trim()}\n`;
}

function renderCommand(c: Command): string {
  const lines = [`description: ${c.description ?? c.name}`];
  if (c.argumentHint) lines.push(`argument-hint: ${c.argumentHint}`);
  return `${frontmatter(lines)}\n${c.body.trim()}\n`;
}

export const claudeAdapter: ProviderAdapter = {
  id: 'claude',
  capabilities: {
    instruction: 'supported',
    rule: 'lossy',
    agent: 'supported',
    command: 'supported',
    mcp: 'supported',
    skill: 'supported',
  },

  plan(ws: CanonicalWorkspace): PlanResult {
    const writes: PlannedWrite[] = [];
    const diagnostics: Diagnostic[] = [];

    // --- CLAUDE.md (regions: one per instruction, one per rule) ---
    const regions: PlannedRegion[] = [];
    for (const { value: i, provenance } of [...ws.instructions].sort((a, b) => byPriority(a.value, b.value))) {
      regions.push({ id: `instruction:${i.id}`, content: `## ${i.title}\n\n${i.body.trim()}`, provenance });
    }
    const rules = [...ws.rules].sort((a, b) => byPriority(a.value, b.value));
    for (const { value: r, provenance } of rules) {
      const note = r.globs.length ? `**Applies to:** \`${r.globs.join('`, `')}\`\n\n` : '';
      regions.push({ id: `rule:${r.id}`, content: `## ${r.title}\n\n${note}${r.body.trim()}`, provenance });
    }
    if (regions.length) writes.push({ ownership: 'regions', path: 'CLAUDE.md', provider: 'claude', regions });
    if (rules.length) {
      diagnostics.push({
        level: 'warn',
        provider: 'claude',
        message: `${rules.length} rule(s) rendered into CLAUDE.md as instructions — Claude has no automatic glob scoping (see "Applies to" notes).`,
      });
    }

    // --- agents ---
    for (const { value, provenance } of [...ws.agents].sort((a, b) => byPriority(a.value, b.value))) {
      writes.push({
        ownership: 'full',
        path: `.claude/agents/${value.id}.md`,
        provider: 'claude',
        content: renderAgent(value),
        provenance,
      });
    }

    // --- commands ---
    for (const { value, provenance } of ws.commands) {
      writes.push({
        ownership: 'full',
        path: `.claude/commands/${value.id}.md`,
        provider: 'claude',
        content: renderCommand(value),
        provenance,
      });
    }

    // --- mcp (.mcp.json) ---
    if (ws.mcp.length) {
      writes.push({
        ownership: 'structured',
        path: '.mcp.json',
        provider: 'claude',
        format: 'json',
        root: 'mcpServers',
        entries: ws.mcp.map(({ value }) => ({ id: value.id, value: mcpConfig(value) })),
        provenance: { source: 'manifest' },
      });
    }

    // --- skills: copy each skill folder verbatim to .claude/skills/<id>/ ---
    for (const { value, provenance } of ws.skills) {
      for (const file of value.files) {
        writes.push({
          ownership: 'full',
          path: `.claude/skills/${value.id}/${file.path}`,
          provider: 'claude',
          content: file.content,
          provenance,
        });
      }
    }

    return { writes, diagnostics };
  },
};
