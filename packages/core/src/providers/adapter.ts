/**
 * Provider port. Adapters are PURE projections: canonical model -> planned writes.
 * They do no I/O — the shared merge engine + fs shell own all reads/writes/merges.
 * This is the "functional core / imperative shell" boundary made literal.
 *
 * plan() returns both the files to write AND diagnostics describing anything the
 * target can't fully represent (lossy/unsupported per the capability matrix), so the
 * pipeline can warn the user *before* writing — never a silent drop.
 */

import type { CapabilityMatrix, CanonicalWorkspace, ProviderId } from '../domain/schema/workspace.js';
import type { PlanResult } from '../domain/schema/lockfile.js';

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly capabilities: CapabilityMatrix;
  /** PURE: model -> files + diagnostics. Same input always yields the same plan. */
  plan(ws: CanonicalWorkspace): PlanResult;
}
