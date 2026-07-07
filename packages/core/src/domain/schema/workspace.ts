/**
 * Canonical Workspace — domain schema (source of truth).
 *
 * Two layers live here, and keeping them distinct is the whole point:
 *
 *   1. WorkspaceManifest  — what the USER authors in `.ai/workspace.json`.
 *                           Terse. References registry artifacts by id + version.
 *                           May inline local additions/overrides.
 *
 *   2. CanonicalWorkspace — the RESOLVED model, after registry fetch + dependency
 *                           resolution. Fully concrete. This is the ONLY thing a
 *                           ProviderAdapter ever sees. Adapters project it; they
 *                           never read the manifest or touch the registry.
 *
 * Pipeline:  manifest -> (registry + deps) -> CanonicalWorkspace -> adapter.plan() -> files
 *
 * This module has ZERO I/O imports on purpose. It is pure domain.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/** kebab-case identifier used for artifacts, agents, providers, skills. */
export const Slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case (e.g. "backend-agent")');

/** semver, loosely — full validation happens in the registry layer. */
export const SemVer = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'must be semver (e.g. "2.1.0")');

export const ProviderId = z.enum(['cursor', 'claude', 'copilot', 'gemini', 'codex']);
export type ProviderId = z.infer<typeof ProviderId>;

/**
 * A model tier expressed provider-neutrally. Adapters map this to a concrete
 * model id (or drop it if the target has no per-agent model concept).
 * Keeping it symbolic is what lets one canonical model target every vendor.
 */
export const ModelTier = z.enum(['fast', 'balanced', 'reasoning', 'default']);
export type ModelTier = z.infer<typeof ModelTier>;

/* ------------------------------------------------------------------ *
 * Capability vocabulary (the union across all providers)
 *
 * Every field here maps to at least one provider. Adapters that can't
 * represent a given capability project it LOSSILY (see capability matrix)
 * and MUST surface a diagnostic — never silently drop.
 * ------------------------------------------------------------------ */

/** Always-applied global guidance. Maps to CLAUDE.md / AGENTS.md / GEMINI.md / copilot-instructions.md. */
export const Instruction = z.object({
  id: Slug,
  title: z.string(),
  body: z.string(),
  /** lower = earlier in the rendered file. Deterministic ordering. */
  priority: z.number().int().default(100),
});
export type Instruction = z.infer<typeof Instruction>;

/** Guidance scoped to files matching globs. First-class in Cursor/Copilot; lossy elsewhere. */
export const Rule = z.object({
  id: Slug,
  title: z.string(),
  body: z.string(),
  /** file globs this rule applies to. Empty + alwaysApply=true => behaves like an Instruction. */
  globs: z.array(z.string()).default([]),
  alwaysApply: z.boolean().default(false),
  priority: z.number().int().default(100),
});
export type Rule = z.infer<typeof Rule>;

/** A subagent / persona. First-class in Claude Code only (today); lossy or dropped elsewhere. */
export const Agent = z.object({
  id: Slug,
  name: z.string(),
  description: z.string(),
  model: ModelTier.default('default'),
  /** allow-list of tool names; empty = inherit all. Provider maps/ignores as able. */
  tools: z.array(z.string()).default([]),
  body: z.string(),
  priority: z.number().int().default(100),
});
export type Agent = z.infer<typeof Agent>;

/** MCP server. Transport is a discriminated union so config shape is validated per-kind. */
export const McpServer = z.discriminatedUnion('transport', [
  z.object({
    id: Slug,
    name: z.string(),
    transport: z.literal('stdio'),
    command: z.string(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
  }),
  z.object({
    id: Slug,
    name: z.string(),
    transport: z.enum(['http', 'sse']),
    url: z.string(), // URL-format validation lives in the registry layer (Zod v4 moved z.string().url())
    headers: z.record(z.string(), z.string()).default({}),
  }),
]);
export type McpServer = z.infer<typeof McpServer>;

/** Reusable prompt / slash command. Claude `.claude/commands`, Copilot prompt files, Gemini TOML, Codex prompts. */
export const Command = z.object({
  id: Slug,
  name: z.string(),
  description: z.string().optional(),
  /** hint shown for `$ARGUMENTS`-style params, provider permitting. */
  argumentHint: z.string().optional(),
  body: z.string(),
});
export type Command = z.infer<typeof Command>;

/**
 * A skill — a FOLDER, per the open SKILL.md standard (Claude `.claude/skills/<id>/`,
 * Copilot `.github/skills/<id>/`). We treat it as an opaque tree of files and copy it
 * verbatim; we do not re-model SKILL.md's internals. `files[].path` is relative to the
 * skill root (e.g. "SKILL.md", "scripts/scan.py").
 */
export const Skill = z.object({
  id: Slug,
  name: z.string(),
  description: z.string().default(''),
  files: z
    .array(z.object({ path: z.string(), content: z.string() }))
    .default([]),
});
export type Skill = z.infer<typeof Skill>;

/* ------------------------------------------------------------------ *
 * Layer 1 — WorkspaceManifest (user-authored `.ai/workspace.json`)
 * ------------------------------------------------------------------ */

/** A registry reference: bare id ("react") pins latest; object form pins a version. */
export const ArtifactRef = z.union([
  Slug,
  z.object({ id: Slug, version: SemVer.optional() }),
]);
export type ArtifactRef = z.infer<typeof ArtifactRef>;

/** Which shared catalog (Git repo) this workspace pulls artifacts + packs from. */
export const RegistryConfig = z.object({
  /** git URL, local path, or file: URL of the catalog repo. */
  url: z.string(),
  /** branch / tag / commit to pin for reproducibility across the team. */
  ref: z.string().default('main'),
});
export type RegistryConfig = z.infer<typeof RegistryConfig>;

export const WorkspaceManifest = z.object({
  /** schema version of THIS manifest file. Bump drives migrations. */
  version: z.literal(1),
  name: z.string().optional(),

  /** which vendors to generate for. Order is cosmetic only. */
  providers: z.array(ProviderId).min(1),

  /** the shared catalog to pull from (optional; a workspace can be fully local). */
  registry: RegistryConfig.optional(),
  /**
   * Catalog selections in "<kind>:<id>" form, e.g. "agent:security-reviewer" or
   * "pack:frontend-team". Managed by `add`/`remove`; expanded against the catalog at
   * resolve time (packs unfold, dependencies pull in). See catalog.ts / catalog logic.
   */
  use: z.array(z.string()).default([]),

  /** registry artifacts to install. Each expands (via deps) into concrete capabilities. */
  skills: z.array(ArtifactRef).default([]),
  agents: z.array(ArtifactRef).default([]),

  /** local, in-repo additions that live alongside registry artifacts. */
  instructions: z.array(Instruction).default([]),
  rules: z.array(Rule).default([]),
  commands: z.array(Command).default([]),
  mcp: z.array(McpServer).default([]),

  /** provider-specific escape hatch; validated by each adapter, opaque to core. */
  overrides: z.partialRecord(ProviderId, z.unknown()).default({}),
});
export type WorkspaceManifest = z.infer<typeof WorkspaceManifest>;

/* ------------------------------------------------------------------ *
 * Layer 2 — CanonicalWorkspace (resolved; the adapter's only input)
 * ------------------------------------------------------------------ */

/** Provenance for a resolved capability — where it came from, so `doctor`/`diff` can explain it. */
export const Provenance = z.object({
  source: z.enum(['manifest', 'registry', 'plugin']),
  /** artifact id + version when source !== 'manifest'. */
  artifactId: Slug.optional(),
  version: SemVer.optional(),
});
export type Provenance = z.infer<typeof Provenance>;

const withProvenance = <T extends z.ZodTypeAny>(t: T) =>
  z.object({ value: t, provenance: Provenance });

export const CanonicalWorkspace = z.object({
  version: z.literal(1),
  name: z.string().optional(),
  providers: z.array(ProviderId).min(1),

  /** every capability, fully concrete and traceable. Deduped + topologically ordered by the resolver. */
  instructions: z.array(withProvenance(Instruction)).default([]),
  rules: z.array(withProvenance(Rule)).default([]),
  agents: z.array(withProvenance(Agent)).default([]),
  commands: z.array(withProvenance(Command)).default([]),
  mcp: z.array(withProvenance(McpServer)).default([]),
  skills: z.array(withProvenance(Skill)).default([]),

  overrides: z.partialRecord(ProviderId, z.unknown()).default({}),
});
export type CanonicalWorkspace = z.infer<typeof CanonicalWorkspace>;

/* ------------------------------------------------------------------ *
 * Capability matrix — the contract each adapter declares.
 * Drives `doctor` diagnostics and pre-generation "this will be lossy" warnings.
 * See docs/design/provider-capability-matrix.md for the filled-in rules.
 * ------------------------------------------------------------------ */

export const CapabilityLevel = z.enum(['supported', 'lossy', 'unsupported']);
export type CapabilityLevel = z.infer<typeof CapabilityLevel>;

export type Capability = 'instruction' | 'rule' | 'agent' | 'command' | 'mcp' | 'skill';

export const CapabilityMatrix = z.object({
  instruction: CapabilityLevel,
  rule: CapabilityLevel,
  agent: CapabilityLevel,
  command: CapabilityLevel,
  mcp: CapabilityLevel,
  skill: CapabilityLevel,
});
export type CapabilityMatrix = z.infer<typeof CapabilityMatrix>;
