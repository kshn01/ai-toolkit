/**
 * Catalog schema — the shared, team-curated set of artifacts + packs that a project
 * pulls from. This is the "distribution" half of the tool: the registry is the SOURCE,
 * the manifest's `use` list is the SELECTION, and generate is the PROJECTION.
 *
 * Pure domain: no I/O. A RegistrySource (in the CLI) loads files into these shapes;
 * everything here just describes and validates them.
 */

import { z } from 'zod';
import { Agent, Command, McpServer, Rule, SemVer, Skill, Slug } from './workspace.js';

/** The kinds of individually-shareable artifact. A "pack" bundles these; it isn't one. */
export const ArtifactKind = z.enum(['agent', 'rule', 'prompt', 'mcp', 'skill']);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

/** A reference string in `kind:id` form, e.g. "agent:security-reviewer" or "pack:frontend-team". */
export const Ref = z
  .string()
  .regex(/^(agent|rule|prompt|mcp|skill|pack):[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be "<kind>:<id>", e.g. "agent:security-reviewer"');
export type Ref = z.infer<typeof Ref>;

export const parseRef = (ref: string): { kind: string; id: string } => {
  const [kind, id] = ref.split(':');
  return { kind: kind ?? '', id: id ?? '' };
};

/**
 * One catalog artifact: metadata + the concrete typed value + its dependencies.
 * The `value` is discriminated by `kind` so an agent carries an Agent, a rule a Rule, etc.
 */
export const CatalogArtifact = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent'), value: Agent, version: SemVer.default('0.0.0'), dependencies: z.array(Ref).default([]) }),
  z.object({ kind: z.literal('rule'), value: Rule, version: SemVer.default('0.0.0'), dependencies: z.array(Ref).default([]) }),
  z.object({ kind: z.literal('prompt'), value: Command, version: SemVer.default('0.0.0'), dependencies: z.array(Ref).default([]) }),
  z.object({ kind: z.literal('mcp'), value: McpServer, version: SemVer.default('0.0.0'), dependencies: z.array(Ref).default([]) }),
  z.object({ kind: z.literal('skill'), value: Skill, version: SemVer.default('0.0.0'), dependencies: z.array(Ref).default([]) }),
]);
export type CatalogArtifact = z.infer<typeof CatalogArtifact>;

/** A curated bundle. `use` may list artifacts AND other packs (nesting is resolved + de-cycled). */
export const CatalogPack = z.object({
  id: Slug,
  description: z.string().default(''),
  version: SemVer.default('0.0.0'),
  use: z.array(Ref).default([]),
});
export type CatalogPack = z.infer<typeof CatalogPack>;

/** The whole catalog, loaded into memory by a RegistrySource. */
export interface Catalog {
  artifacts: CatalogArtifact[];
  packs: CatalogPack[];
}
