/**
 * Workspace lockfile — the record of "what the tool generated, and from what".
 *
 * Persisted at `.ai/workspace-lock.json`. This is the memory that turns a
 * template generator into a package manager: it lets every subsequent run answer
 * "did the user touch this since I last wrote it?" and "is this file still ours?".
 *
 * Design rule: the lockfile stores HASHES (fast change detection). The actual
 * last-generated CONTENT is cached separately under `.ai/cache/blobs/<hash>` so a
 * true three-way merge (user, base, new) is possible on divergence. Hash-in-lock +
 * content-in-cache = fast common path AND real merges when needed.
 *
 * Pure domain: no I/O here.
 */

import { z } from 'zod';
import { ProviderId, Provenance, SemVer } from './workspace.js';

/** sha256 hex of the FINAL bytes written to disk (post-formatting — see merge-engine.md). */
export const ContentHash = z.string().regex(/^[a-f0-9]{64}$/, 'sha256 hex');

/**
 * How the tool owns a target file.
 *  - full:       entire file is generated (e.g. `.claude/agents/x.md`).
 *  - regions:    file mixes generated regions with user prose (e.g. `CLAUDE.md`).
 *  - structured: file is JSON/TOML; we own specific keys, not the whole file (e.g. `.mcp.json`).
 */
export const Ownership = z.enum(['full', 'regions', 'structured']);
export type Ownership = z.infer<typeof Ownership>;

/** A single managed region inside a `regions`-owned file. */
export const RegionEntry = z.object({
  /** stable marker id, e.g. artifact id. Determines marker text + ordering. */
  id: z.string(),
  hash: ContentHash,
  provenance: Provenance,
});
export type RegionEntry = z.infer<typeof RegionEntry>;

/** The set of top-level keys the tool owns in a `structured` file (dot-paths). */
export const StructuredKeys = z.array(z.string());

export const LockEntry = z.object({
  /** repo-relative path. */
  path: z.string(),
  provider: ProviderId,
  ownership: Ownership,

  /** for ownership=full: hash of the whole generated file. */
  hash: ContentHash.optional(),
  /** for ownership=regions: one entry per managed region, in written order. */
  regions: z.array(RegionEntry).optional(),
  /** for ownership=structured: the root object we merge into, which keys we manage + hash. */
  root: z.string().optional(),
  keys: StructuredKeys.optional(),
  keysHash: ContentHash.optional(),

  provenance: Provenance,
});
export type LockEntry = z.infer<typeof LockEntry>;

export const WorkspaceLock = z.object({
  /** lockfile schema version — independent from the manifest version; drives lock migrations. */
  lockVersion: z.literal(1),
  /** tool version that last wrote this lock (diagnostic + migration hint). */
  tool: SemVer,
  /** hash of the resolved CanonicalWorkspace this lock corresponds to (fast "did anything change?" gate). */
  workspaceHash: ContentHash,
  entries: z.array(LockEntry).default([]),
});
export type WorkspaceLock = z.infer<typeof WorkspaceLock>;

/* ------------------------------------------------------------------ *
 * Merge engine value types (consumed by the imperative shell)
 * ------------------------------------------------------------------ */

/** One managed region inside a `regions` file. */
export interface PlannedRegion {
  id: string;
  content: string;
  provenance: Provenance;
}

/** One owned key/value inside a `structured` file (e.g. an mcp server keyed by id). */
export interface StructuredEntry {
  id: string;
  value: unknown;
}

/**
 * A thing an adapter wants to exist on disk. Discriminated by `ownership` so each
 * kind carries exactly the payload its merge strategy needs — no `unknown` casts.
 */
export type PlannedWrite =
  | {
      ownership: 'full';
      path: string;
      provider: ProviderId;
      content: string;
      provenance: Provenance;
    }
  | {
      ownership: 'regions';
      path: string;
      provider: ProviderId;
      regions: PlannedRegion[];
    }
  | {
      ownership: 'structured';
      path: string;
      provider: ProviderId;
      format: 'json';
      /** top-level object we merge into, e.g. "mcpServers". */
      root: string;
      entries: StructuredEntry[];
      provenance: Provenance;
    };

/** A message an adapter surfaces about lossy/unsupported projection. */
export interface Diagnostic {
  level: 'info' | 'warn';
  provider: ProviderId;
  message: string;
}

/** What an adapter's plan() returns: the files it wants + what it couldn't fully represent. */
export interface PlanResult {
  writes: PlannedWrite[];
  diagnostics: Diagnostic[];
}

/** The decision the three-way engine reaches for a planned write. See state table in merge-engine.md. */
export type MergeAction =
  | 'create' // new file/region, nothing existed
  | 'noop' // disk already equals desired output — zero writes (the idempotency case)
  | 'update' // disk == base (untouched by user) and output differs — safe overwrite
  | 'keep' // user edited; upstream unchanged — preserve the user's version
  | 'merge' // user edited AND upstream changed; three-way merged cleanly
  | 'conflict' // three-way overlap — needs resolution (prompt / markers / fail)
  | 'restore' // user deleted a tracked file/region the manifest still wants
  | 'orphan-remove' // in lock but no longer planned — delete (if unedited)
  | 'orphan-keep'; // in lock, no longer planned, but user-edited — leave + warn

export interface MergeOutcome {
  path: string;
  action: MergeAction;
  /** filled when action==='conflict' and running non-interactively. */
  conflictDetail?: string;
  /** the bytes to write (absent for noop/keep/orphan-keep). */
  resolved?: string;
}
