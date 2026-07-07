/** Small helpers shared by adapters. Pure. */

import type { McpServer } from '../domain/schema/workspace.js';

/** Deterministic order: by priority, then id. Keeps generated output stable. */
export const byPriority = <T extends { priority: number; id: string }>(a: T, b: T): number =>
  a.priority - b.priority || a.id.localeCompare(b.id);

/** Build a `---` YAML frontmatter block from ordered key/value lines. */
export const frontmatter = (lines: string[]): string => `---\n${lines.join('\n')}\n---\n`;

/** Canonical MCP server -> the JSON value most tools expect under mcpServers[id]. */
export function mcpConfig(m: McpServer): Record<string, unknown> {
  if (m.transport === 'stdio') {
    const cfg: Record<string, unknown> = { command: m.command };
    if (m.args.length) cfg.args = m.args;
    if (Object.keys(m.env).length) cfg.env = m.env;
    return cfg;
  }
  const cfg: Record<string, unknown> = { type: m.transport, url: m.url };
  if (Object.keys(m.headers).length) cfg.headers = m.headers;
  return cfg;
}
