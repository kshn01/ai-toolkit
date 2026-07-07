/**
 * Generation pipeline — the imperative shell.
 *
 *   manifest -> resolve -> [adapter.plan]* -> merge(per ownership) -> write + lockfile
 *
 * All decision logic lives in the pure core (resolve, decidePlanned/decideOrphan,
 * mergeRegions, mergeStructured). This file only does I/O and assembles the new lock.
 * `dryRun` runs the identical path but writes nothing — that's how `diff` works.
 */

import path from 'node:path';
import {
  type Diagnostic,
  type LockEntry,
  type MergeAction,
  type ProviderAdapter,
  type RegionEntry,
  type WorkspaceLock,
  resolve,
  baselineFor,
  decideOrphan,
  decidePlanned,
  mergeRegions,
  mergeStructured,
  claudeAdapter,
  copilotAdapter,
} from '@ai-workspace/core';
import { loadCustomAgents } from './infra/agents-loader.js';
import { readManifest } from './infra/manifest.js';
import { openRegistry } from './infra/registry.js';
import {
  cacheBlob,
  loadBlob,
  loadLock,
  readIfExists,
  removeIfExists,
  saveLock,
  sha256,
  writeFileEnsured,
} from './infra/fs-shell.js';

const ADAPTERS: Record<string, ProviderAdapter> = {
  claude: claudeAdapter,
  copilot: copilotAdapter,
};
const TOOL_VERSION = '0.0.0';

export interface Outcome {
  path: string;
  action: MergeAction;
}
export interface RunResult {
  outcomes: Outcome[];
  diagnostics: Diagnostic[];
  conflicts: number;
}

/** Collapse per-region actions into one file-level action for display. */
function aggregate(actions: MergeAction[], isNew: boolean): MergeAction {
  if (actions.includes('conflict')) return 'conflict';
  if (actions.some((a) => ['create', 'update', 'restore', 'orphan-remove'].includes(a)))
    return isNew ? 'create' : 'update';
  if (actions.some((a) => a === 'keep' || a === 'orphan-keep')) return 'keep';
  return 'noop';
}

export async function runGenerate(root: string, opts: { dryRun?: boolean } = {}): Promise<RunResult> {
  const manifest = await readManifest(root);
  const registry = openRegistry(manifest.registry, root); // shared catalog (Git or local)
  const catalog = registry ? await registry.load() : undefined;
  const customAgents = await loadCustomAgents(root); // .ai/agents/*.md — zero-code agents
  const ws = resolve(manifest, { customAgents, catalog });

  const plans = ws.providers.map((p) => ADAPTERS[p]?.plan(ws)).filter((r) => r !== undefined);
  const planned = plans.flatMap((r) => r.writes);
  const diagnostics = plans.flatMap((r) => r.diagnostics);

  const prevLock = await loadLock(root);
  const prevByPath = new Map((prevLock?.entries ?? []).map((e) => [e.path, e]));
  const plannedPaths = new Set(planned.map((w) => w.path));

  const outcomes: Outcome[] = [];
  const newEntries: LockEntry[] = [];
  let conflicts = 0;
  const write = async (abs: string, content: string) => {
    if (!opts.dryRun) await writeFileEnsured(abs, content);
  };

  for (const w of planned) {
    const abs = path.join(root, w.path);
    const prev = prevByPath.get(w.path);
    const disk = await readIfExists(abs);

    if (w.ownership === 'full') {
      const base = prev?.hash ? await loadBlob(root, prev.hash) : undefined;
      const decision = decidePlanned({ base, disk, next: w.content });
      outcomes.push({ path: w.path, action: decision.action });
      if (decision.action === 'conflict') conflicts++;

      const baseline = baselineFor(decision, base, w.content);
      if (decision.resolved !== undefined) await write(abs, decision.resolved);
      if (!opts.dryRun && baseline !== undefined) await cacheBlob(root, baseline);
      newEntries.push({
        path: w.path,
        provider: w.provider,
        ownership: 'full',
        hash: baseline !== undefined ? sha256(baseline) : undefined,
        provenance: w.provenance,
      });
    } else if (w.ownership === 'regions') {
      const priorBase = new Map<string, string>();
      for (const r of prev?.regions ?? []) {
        const c = await loadBlob(root, r.hash);
        if (c !== undefined) priorBase.set(r.id, c);
      }
      const { content, results, baselines } = mergeRegions({ existing: disk, planned: w.regions, priorBase });
      const actions = results.map((r) => r.action);
      outcomes.push({ path: w.path, action: aggregate(actions, disk === undefined) });
      conflicts += actions.filter((a) => a === 'conflict').length;

      if (disk === undefined || content !== disk) await write(abs, content);
      if (!opts.dryRun) for (const b of baselines) await cacheBlob(root, b.content);

      const regions: RegionEntry[] = baselines.map((b) => ({
        id: b.id,
        hash: sha256(b.content),
        provenance: b.provenance,
      }));
      newEntries.push({ path: w.path, provider: w.provider, ownership: 'regions', regions, provenance: { source: 'manifest' } });
    } else {
      // structured
      const { content, ownedKeys, action } = mergeStructured({
        existing: disk,
        root: w.root,
        entries: w.entries,
        priorKeys: prev?.keys ?? [],
      });
      outcomes.push({ path: w.path, action: action === 'remove' ? 'orphan-remove' : action });
      if (action === 'remove') {
        if (!opts.dryRun) await removeIfExists(abs);
      } else {
        if (disk === undefined || content !== disk) await write(abs, content);
        newEntries.push({
          path: w.path,
          provider: w.provider,
          ownership: 'structured',
          root: w.root,
          keys: ownedKeys,
          keysHash: sha256(content),
          provenance: w.provenance,
        });
      }
    }
  }

  // --- orphans: tracked last run, not planned now ---
  for (const prev of prevByPath.values()) {
    if (plannedPaths.has(prev.path)) continue;
    const abs = path.join(root, prev.path);
    const disk = await readIfExists(abs);

    if (prev.ownership === 'full') {
      const base = prev.hash ? await loadBlob(root, prev.hash) : '';
      const { action } = decideOrphan({ base: base ?? '', disk });
      outcomes.push({ path: prev.path, action });
      if (action === 'orphan-remove') {
        if (!opts.dryRun) await removeIfExists(abs);
      } else {
        newEntries.push(prev); // keep tracking the user-edited orphan
      }
    } else if (prev.ownership === 'regions') {
      const priorBase = new Map<string, string>();
      for (const r of prev.regions ?? []) {
        const c = await loadBlob(root, r.hash);
        if (c !== undefined) priorBase.set(r.id, c);
      }
      const { content } = mergeRegions({ existing: disk, planned: [], priorBase });
      const emptied = content.trim().length === 0;
      outcomes.push({ path: prev.path, action: emptied ? 'orphan-remove' : 'orphan-keep' });
      if (emptied) {
        if (!opts.dryRun) await removeIfExists(abs);
      } else if (disk !== undefined && content !== disk) {
        await write(abs, content); // strip our blocks, keep user prose
      }
    } else {
      const { content, action } = mergeStructured({
        existing: disk,
        root: prev.root ?? 'mcpServers',
        entries: [],
        priorKeys: prev.keys ?? [],
      });
      outcomes.push({ path: prev.path, action: action === 'remove' ? 'orphan-remove' : 'update' });
      if (action === 'remove') {
        if (!opts.dryRun) await removeIfExists(abs);
      } else if (disk !== undefined && content !== disk) {
        await write(abs, content); // drop our keys, keep user's
      }
    }
  }

  if (!opts.dryRun) {
    const lock: WorkspaceLock = {
      lockVersion: 1,
      tool: TOOL_VERSION,
      workspaceHash: sha256(JSON.stringify(ws)),
      entries: newEntries.sort((a, b) => a.path.localeCompare(b.path)),
    };
    await saveLock(root, lock);
  }

  return { outcomes, diagnostics, conflicts };
}
