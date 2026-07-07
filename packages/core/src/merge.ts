/**
 * Merge engine — PURE. The 11-row state table from docs/design/merge-engine.md.
 *
 * M0 scope: ownership='full' only (whole-file units). No diff3 auto-merge yet —
 * row 9 divergence is reported as 'conflict' and left for the user. Region +
 * structured ownership and diff3 are the next increment; the table shape does
 * not change, only how a "unit" is sliced.
 *
 * Purity is the point: this function does no I/O. The shell computes base/disk/
 * next strings and feeds them in, so the whole table is trivially unit-testable.
 */

import type { MergeAction } from './domain/schema/lockfile.js';

export interface PlannedDecision {
  /** last-generated content (from blob cache); undefined = no lock entry. */
  base?: string;
  /** current on-disk content; undefined = file absent. */
  disk?: string;
  /** freshly rendered content the plan wants. */
  next: string;
}

export interface OrphanDecision {
  base: string;
  disk?: string;
}

export interface Decision {
  action: MergeAction;
  /** bytes to write; absent means "leave disk as-is". */
  resolved?: string;
}

/** A planned write (the file is in the current plan). Rows 1–9. */
export function decidePlanned({ base, disk, next }: PlannedDecision): Decision {
  // No prior generation of this path.
  if (base === undefined) {
    if (disk === undefined) return { action: 'create', resolved: next }; // row 1
    if (disk === next) return { action: 'noop' }; // row 2 (adopt identical)
    return { action: 'conflict' }; // row 3 (untracked pre-existing file)
  }

  // Tracked, but user deleted it.
  if (disk === undefined) return { action: 'restore', resolved: next }; // row 4

  // Tracked and present.
  if (disk === base) {
    if (next === base) return { action: 'noop' }; // row 5 — the idempotency case
    return { action: 'update', resolved: next }; // row 6
  }

  // User edited (disk !== base).
  if (next === base) return { action: 'keep' }; // row 7 — preserve user edit
  if (next === disk) return { action: 'noop' }; // row 8 — converged
  return { action: 'conflict' }; // row 9 — M0: no auto-merge yet
}

/** A lock entry no longer in the plan. Rows 10–11. */
export function decideOrphan({ base, disk }: OrphanDecision): Decision {
  if (disk === undefined || disk === base) return { action: 'orphan-remove' }; // row 10
  return { action: 'orphan-keep' }; // row 11 — user-edited, don't delete
}

/**
 * What to record as the new lock baseline for a decision.
 *
 * THE INVARIANT: the baseline is always the tool's clean generated output (`next`),
 * NEVER the user's edited disk content — otherwise a 'keep' promotes the edit to
 * baseline and the *next* run overwrites it. Exception: an unresolved conflict keeps
 * the prior baseline so divergence stays detected. (This is the bug the regression
 * test in merge.test.ts guards.)
 */
export function baselineFor(decision: Decision, base: string | undefined, next: string): string | undefined {
  if (decision.resolved !== undefined) return decision.resolved; // create/update/restore/merge
  if (decision.action === 'conflict') return base; // preserve prior baseline
  return next; // noop / keep -> clean generated output
}
