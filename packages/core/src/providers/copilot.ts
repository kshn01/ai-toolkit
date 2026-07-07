/**
 * GitHub Copilot adapter. Projects:
 *
 *   instructions -> .github/copilot-instructions.md          (regions)
 *   rules        -> .github/instructions/<id>.instructions.md (full, `applyTo` frontmatter)
 *   commands     -> .github/prompts/<id>.prompt.md            (full)
 *   agents       -> UNSUPPORTED — dropped with a diagnostic (Copilot has no subagents)
 *   mcp          -> LOSSY — not generated; editor-scoped config isn't repo-portable
 *
 * Rules are 'supported' here (unlike Claude): Copilot's `applyTo` glob is a native
 * per-file scoping mechanism, so no information is lost.
 */

import type { CanonicalWorkspace, Command, Rule } from '../domain/schema/workspace.js';
import type { Diagnostic, PlanResult, PlannedRegion, PlannedWrite } from '../domain/schema/lockfile.js';
import type { ProviderAdapter } from './adapter.js';
import { byPriority, frontmatter } from './shared.js';

function renderRuleFile(r: Rule): string {
  const applyTo = r.globs.length ? r.globs.join(',') : '**';
  return `${frontmatter([`applyTo: "${applyTo}"`])}\n${r.body.trim()}\n`;
}

function renderPrompt(c: Command): string {
  const lines = [`description: ${c.description ?? c.name}`];
  return `${frontmatter(lines)}\n${c.body.trim()}\n`;
}

export const copilotAdapter: ProviderAdapter = {
  id: 'copilot',
  capabilities: {
    instruction: 'supported',
    rule: 'supported',
    agent: 'unsupported',
    command: 'supported',
    mcp: 'lossy',
    skill: 'supported',
  },

  plan(ws: CanonicalWorkspace): PlanResult {
    const writes: PlannedWrite[] = [];
    const diagnostics: Diagnostic[] = [];

    // --- copilot-instructions.md (regions) ---
    const regions: PlannedRegion[] = [];
    for (const { value: i, provenance } of [...ws.instructions].sort((a, b) => byPriority(a.value, b.value))) {
      regions.push({ id: `instruction:${i.id}`, content: `## ${i.title}\n\n${i.body.trim()}`, provenance });
    }
    if (regions.length) {
      writes.push({
        ownership: 'regions',
        path: '.github/copilot-instructions.md',
        provider: 'copilot',
        regions,
      });
    }

    // --- rules -> native applyTo instruction files ---
    for (const { value, provenance } of [...ws.rules].sort((a, b) => byPriority(a.value, b.value))) {
      writes.push({
        ownership: 'full',
        path: `.github/instructions/${value.id}.instructions.md`,
        provider: 'copilot',
        content: renderRuleFile(value),
        provenance,
      });
    }

    // --- commands -> prompt files ---
    for (const { value, provenance } of ws.commands) {
      writes.push({
        ownership: 'full',
        path: `.github/prompts/${value.id}.prompt.md`,
        provider: 'copilot',
        content: renderPrompt(value),
        provenance,
      });
    }

    // --- agents: unsupported, drop loudly ---
    if (ws.agents.length) {
      diagnostics.push({
        level: 'warn',
        provider: 'copilot',
        message: `${ws.agents.length} agent(s) dropped — Copilot has no subagent concept.`,
      });
    }

    // --- mcp: lossy, not generated ---
    if (ws.mcp.length) {
      diagnostics.push({
        level: 'warn',
        provider: 'copilot',
        message: `${ws.mcp.length} MCP server(s) not generated for Copilot (editor-scoped config isn't repo-portable).`,
      });
    }

    // --- skills: copy each skill folder verbatim to .github/skills/<id>/ ---
    for (const { value, provenance } of ws.skills) {
      for (const file of value.files) {
        writes.push({
          ownership: 'full',
          path: `.github/skills/${value.id}/${file.path}`,
          provider: 'copilot',
          content: file.content,
          provenance,
        });
      }
    }

    return { writes, diagnostics };
  },
};
