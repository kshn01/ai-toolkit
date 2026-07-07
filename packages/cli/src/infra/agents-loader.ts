/**
 * Custom-agents loader. Drop a markdown file in `.ai/agents/<id>.md` and it becomes
 * an agent — no code, no manifest entry. The filename is the agent id; the frontmatter
 * gives its name/description/model; the body is the agent's prompt.
 *
 * Example `.ai/agents/security-reviewer.md`:
 *
 *   ---
 *   name: Security Reviewer
 *   description: Reviews code for vulnerabilities
 *   model: reasoning
 *   ---
 *   You are a meticulous security reviewer. Flag injection, authz, and secret-handling bugs.
 *
 * This is I/O (reads the filesystem), so it lives in the CLI shell. It hands plain
 * data to the pure core, which validates it via the Agent schema.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
// `Agent` is both the Zod schema (value) and its inferred type — one import, both uses.
import { Agent, friendlyError } from '@ai-workspace/core';
import { frontmatter, toStringArray } from './frontmatter.js';

export async function loadCustomAgents(root: string): Promise<Agent[]> {
  const dir = path.join(root, '.ai', 'agents');
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return []; // no folder = no custom agents; that's fine
  }

  const agents: Agent[] = [];
  for (const file of files.filter((f) => f.endsWith('.md')).sort()) {
    const id = path.basename(file, '.md');
    const raw = await fs.readFile(path.join(dir, file), 'utf8');
    const { data, body } = frontmatter(raw);
    try {
      agents.push(
        Agent.parse({
          id,
          name: data.name ?? id,
          description: data.description ?? '',
          model: data.model ?? 'default',
          tools: toStringArray(data.tools),
          body: body.trim(),
          priority: data.priority ?? 100,
        }),
      );
    } catch (err) {
      throw new Error(`invalid agent file .ai/agents/${file}:\n${friendlyError(err)}`);
    }
  }
  return agents;
}
