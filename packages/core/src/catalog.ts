/**
 * Catalog expansion — PURE. Turns a list of `use` refs (from the manifest) plus an
 * in-memory Catalog into the concrete artifacts to install.
 *
 * Responsibilities:
 *   1. Expand packs -> their member refs (packs may nest; cycles are detected).
 *   2. Pull in each artifact's dependencies (also de-cycled).
 *   3. Route each resolved artifact to the right bucket by kind (agents/rules/…).
 *   4. Fail loudly on unknown refs or cycles — never silently skip.
 *
 * No I/O: the CLI loads the Catalog from Git/disk and hands it in. This function just
 * walks data, which makes the tricky graph logic trivially testable.
 */

import type { Agent, Command, McpServer, Rule, Skill } from './domain/schema/workspace.js';
import { type Catalog, type CatalogArtifact, parseRef } from './domain/schema/catalog.js';

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

export interface ExpandedUse {
  agents: Agent[];
  rules: Rule[];
  commands: Command[];
  mcp: McpServer[];
  skills: Skill[];
}

/**
 * @param use      refs from manifest.use, e.g. ["agent:security-reviewer", "pack:frontend-team"]
 * @param catalog  the loaded catalog (artifacts + packs)
 */
export function expandUse(use: string[], catalog: Catalog): ExpandedUse {
  const artifactByRef = new Map(catalog.artifacts.map((a) => [`${a.kind}:${a.value.id}`, a]));
  const packById = new Map(catalog.packs.map((p) => [p.id, p]));

  const resolved = new Map<string, CatalogArtifact>(); // ref -> artifact (dedup)
  const visiting = new Set<string>(); // for cycle detection across packs + deps

  const visit = (ref: string, trail: string[]): void => {
    if (resolved.has(ref)) return;
    if (visiting.has(ref)) {
      throw new CatalogError(`circular reference: ${[...trail, ref].join(' -> ')}`);
    }
    visiting.add(ref);

    const { kind, id } = parseRef(ref);
    if (kind === 'pack') {
      const pack = packById.get(id);
      if (!pack) throw new CatalogError(`unknown pack "${id}" (referenced by ${trail.at(-1) ?? 'manifest'})`);
      for (const member of pack.use) visit(member, [...trail, ref]);
    } else {
      const artifact = artifactByRef.get(ref);
      if (!artifact) throw new CatalogError(`unknown ${kind} "${id}" (referenced by ${trail.at(-1) ?? 'manifest'})`);
      // pull dependencies first so ordering is stable and deps are guaranteed present
      for (const dep of artifact.dependencies) visit(dep, [...trail, ref]);
      resolved.set(ref, artifact);
    }

    visiting.delete(ref);
  };

  for (const ref of use) visit(ref, []);

  const out: ExpandedUse = { agents: [], rules: [], commands: [], mcp: [], skills: [] };
  for (const artifact of resolved.values()) {
    switch (artifact.kind) {
      case 'agent':
        out.agents.push(artifact.value);
        break;
      case 'rule':
        out.rules.push(artifact.value);
        break;
      case 'prompt':
        out.commands.push(artifact.value);
        break;
      case 'mcp':
        out.mcp.push(artifact.value);
        break;
      case 'skill':
        out.skills.push(artifact.value);
        break;
    }
  }
  return out;
}
