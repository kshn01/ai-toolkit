/**
 * Resolver — manifest (+ catalog + folder files) -> CanonicalWorkspace (concrete).
 *
 * Three sources feed the resolved model, in precedence order:
 *   1. local files      — `.ai/agents/*.md` (highest — a project override)
 *   2. catalog `use`     — artifacts pulled from the shared registry, packs expanded
 *   3. manifest inline / built-ins — instructions/rules authored in the manifest, plus
 *                          a couple of built-in agents
 *
 * Pure: the CLI loads the catalog (I/O) and folder agents (I/O) and passes them in.
 */

import {
  type Agent,
  CanonicalWorkspace,
  type Provenance,
  type WorkspaceManifest,
} from './domain/schema/workspace.js';
import type { Catalog } from './domain/schema/catalog.js';
import { expandUse } from './catalog.js';

export class RegistryError extends Error {
  constructor(public readonly artifactId: string) {
    super(`unknown artifact "${artifactId}" (not in registry)`);
    this.name = 'RegistryError';
  }
}

/** Built-in agents available without a catalog (kept minimal; the catalog is the real source). */
const LOCAL_REGISTRY: Record<string, Agent> = {
  architect: {
    id: 'architect',
    name: 'Architect',
    description: 'Designs system architecture and reviews structural decisions.',
    model: 'reasoning',
    tools: [],
    body: 'You are a senior software architect. Favor clarity, small seams, and reversible decisions.',
    priority: 100,
  },
};

const refId = (ref: string | { id: string }): string => (typeof ref === 'string' ? ref : ref.id);

const LOCAL: Provenance = { source: 'manifest' };
const fromRegistry = (id: string): Provenance => ({ source: 'registry', artifactId: id });

interface WithProv<T> {
  value: T;
  provenance: Provenance;
}

/** First occurrence of each id wins (callers pass higher-precedence sources first). */
function mergeById<T extends { id: string }>(items: WithProv<T>[]): WithProv<T>[] {
  const byId = new Map<string, WithProv<T>>();
  for (const item of items) if (!byId.has(item.value.id)) byId.set(item.value.id, item);
  return [...byId.values()];
}

export function resolve(
  manifest: WorkspaceManifest,
  opts: { customAgents?: Agent[]; catalog?: Catalog } = {},
): CanonicalWorkspace {
  const { customAgents = [], catalog } = opts;
  const expanded = catalog
    ? expandUse(manifest.use, catalog)
    : { agents: [], rules: [], commands: [], mcp: [], skills: [] };

  // Agents: folder files > catalog > built-in, deduped by id.
  const agents = mergeById<Agent>([
    ...customAgents.map((value) => ({ value, provenance: LOCAL })),
    ...expanded.agents.map((value) => ({ value, provenance: fromRegistry(value.id) })),
    ...manifest.agents.map((ref) => {
      const id = refId(ref);
      const value = LOCAL_REGISTRY[id];
      if (!value) throw new RegistryError(id);
      return { value, provenance: fromRegistry(id) };
    }),
  ]);

  // Rules / commands / mcp: manifest inline (local) > catalog, deduped by id.
  const rules = mergeById([
    ...manifest.rules.map((value) => ({ value, provenance: LOCAL })),
    ...expanded.rules.map((value) => ({ value, provenance: fromRegistry(value.id) })),
  ]);
  const commands = mergeById([
    ...manifest.commands.map((value) => ({ value, provenance: LOCAL })),
    ...expanded.commands.map((value) => ({ value, provenance: fromRegistry(value.id) })),
  ]);
  const mcp = mergeById([
    ...manifest.mcp.map((value) => ({ value, provenance: LOCAL })),
    ...expanded.mcp.map((value) => ({ value, provenance: fromRegistry(value.id) })),
  ]);
  const instructions = manifest.instructions.map((value) => ({ value, provenance: LOCAL }));
  const skills = expanded.skills.map((value) => ({ value, provenance: fromRegistry(value.id) }));

  // parse() applies defaults and guarantees the adapter sees a fully-valid model.
  return CanonicalWorkspace.parse({
    version: 1,
    name: manifest.name,
    providers: manifest.providers,
    instructions,
    agents,
    rules,
    commands,
    mcp,
    skills,
    overrides: manifest.overrides,
  });
}
