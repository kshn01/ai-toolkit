/**
 * Structured merge — PURE. For JSON config files (.mcp.json) we do NOT diff text;
 * we deep-set only the keys we own into the parsed object and leave everything else
 * untouched. That's how a user's hand-added key survives an update, and how removing
 * an artifact cleanly drops only the entries it created.
 *
 * M-complete scope: one `root` object (e.g. "mcpServers") keyed by id. We overwrite
 * owned keys and remove owned-but-no-longer-planned keys. Detecting a user edit to a
 * key we own (structured conflict) is a later refinement — noted, not silently wrong.
 */

import type { StructuredEntry } from './domain/schema/lockfile.js';

export interface MergeStructuredInput {
  existing?: string;
  root: string;
  entries: StructuredEntry[];
  /** ids we owned last run (for cleanup of removed entries). */
  priorKeys: string[];
}

export interface MergeStructuredOutput {
  /** serialized JSON; the sentinel '' means "the file would be empty — remove it". */
  content: string;
  ownedKeys: string[];
  action: 'create' | 'update' | 'noop' | 'remove';
  removed: string[];
}

export function mergeStructured({
  existing,
  root,
  entries,
  priorKeys,
}: MergeStructuredInput): MergeStructuredOutput {
  const obj: Record<string, unknown> = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
  const bag: Record<string, unknown> = { ...((obj[root] as Record<string, unknown>) ?? {}) };

  for (const e of entries) bag[e.id] = e.value;

  const plannedIds = new Set(entries.map((e) => e.id));
  const removed: string[] = [];
  for (const k of priorKeys) {
    if (!plannedIds.has(k) && k in bag) {
      delete bag[k];
      removed.push(k);
    }
  }

  if (Object.keys(bag).length === 0) delete obj[root];
  else obj[root] = bag;

  // If the whole object is now empty and we created it, signal file removal.
  if (Object.keys(obj).length === 0) {
    return { content: '', ownedKeys: [], action: existing ? 'remove' : 'noop', removed };
  }

  const content = `${JSON.stringify(obj, null, 2)}\n`;
  const action = existing === undefined ? 'create' : content === existing ? 'noop' : 'update';
  return { content, ownedKeys: entries.map((e) => e.id), action, removed };
}
