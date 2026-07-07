/**
 * Region merge — PURE. Handles files that mix generated blocks with user prose
 * (CLAUDE.md, copilot-instructions.md). Text OUTSIDE every marker is user territory
 * and is preserved byte-for-byte; each marked region gets the three-way state table.
 *
 * Markers:
 *   <!-- ai-workspace:begin id=<id> -->
 *   ...managed content...
 *   <!-- ai-workspace:end id=<id> -->
 *
 * The lockfile holds each region's baseline hash; the pipeline loads the matching
 * blob and passes the base *content* in via `priorBase`, so a real per-region
 * three-way is possible.
 */

import type { Provenance } from './domain/schema/workspace.js';
import type { MergeAction, PlannedRegion } from './domain/schema/lockfile.js';
import { baselineFor, decidePlanned } from './merge.js';

const begin = (id: string) => `<!-- ai-workspace:begin id=${id} -->`;
const end = (id: string) => `<!-- ai-workspace:end id=${id} -->`;
const BLOCK_RE = /<!-- ai-workspace:begin id=(\S+) -->\n([\s\S]*?)\n<!-- ai-workspace:end id=\1 -->/g;

const renderRegion = (id: string, inner: string) => `${begin(id)}\n${inner}\n${end(id)}`;

interface Node {
  type: 'text' | 'region';
  value: string;
  id?: string;
}

function parse(text: string): Node[] {
  const nodes: Node[] = [];
  let last = 0;
  for (const m of text.matchAll(BLOCK_RE)) {
    const start = m.index ?? 0;
    if (start > last) nodes.push({ type: 'text', value: text.slice(last, start) });
    nodes.push({ type: 'region', id: m[1], value: m[2] ?? '' });
    last = start + m[0].length;
  }
  if (last < text.length) nodes.push({ type: 'text', value: text.slice(last) });
  return nodes;
}

const render = (nodes: Node[]) =>
  nodes.map((n) => (n.type === 'text' ? n.value : renderRegion(n.id ?? '', n.value))).join('');

export interface RegionResult {
  id: string;
  action: MergeAction;
}

export interface RegionBaseline {
  id: string;
  content: string;
  provenance: Provenance;
}

export interface MergeRegionsInput {
  existing?: string;
  planned: PlannedRegion[];
  /** regionId -> last generated content (from blob cache). */
  priorBase: Map<string, string>;
}

export interface MergeRegionsOutput {
  content: string;
  results: RegionResult[];
  /** regions we own going forward — hash + cache these, and write them to the lock. */
  baselines: RegionBaseline[];
}

export function mergeRegions({ existing, planned, priorBase }: MergeRegionsInput): MergeRegionsOutput {
  const plannedById = new Map(planned.map((p) => [p.id, p]));
  const results: RegionResult[] = [];
  const baselines: RegionBaseline[] = [];

  // Fresh file: emit every planned region in order.
  if (existing === undefined) {
    for (const p of planned) {
      results.push({ id: p.id, action: 'create' });
      baselines.push({ id: p.id, content: p.content, provenance: p.provenance });
    }
    const body = planned.map((p) => renderRegion(p.id, p.content)).join('\n\n');
    return { content: planned.length ? `${body}\n` : '', results, baselines };
  }

  const nodes = parse(existing);
  const seen = new Set<string>();
  const out: Node[] = [];

  for (const node of nodes) {
    if (node.type !== 'region') {
      out.push(node);
      continue;
    }
    const id = node.id ?? '';
    seen.add(id);
    const plan = plannedById.get(id);
    const base = priorBase.get(id);

    // Region no longer planned -> orphan (rows 10-11, per region).
    if (!plan) {
      if (base === undefined || base === node.value) {
        results.push({ id, action: 'orphan-remove' }); // drop the block
      } else {
        results.push({ id, action: 'orphan-keep' }); // user edited it — keep verbatim
        out.push(node);
      }
      continue;
    }

    const decision = decidePlanned({ base, disk: node.value, next: plan.content });
    results.push({ id, action: decision.action });
    // keep/conflict/noop leave the on-disk inner; create/update/restore take `resolved`.
    out.push({ type: 'region', id, value: decision.resolved ?? node.value });
    const baseline = baselineFor(decision, base, plan.content);
    if (baseline !== undefined) baselines.push({ id, content: baseline, provenance: plan.provenance });
  }

  // Planned regions whose markers weren't found -> append (create if new, restore if tracked).
  const missing = planned.filter((p) => !seen.has(p.id));
  for (const p of missing) {
    results.push({ id: p.id, action: priorBase.has(p.id) ? 'restore' : 'create' });
    baselines.push({ id: p.id, content: p.content, provenance: p.provenance });
  }

  let content = render(out);
  if (missing.length) {
    const tail = missing.map((p) => renderRegion(p.id, p.content)).join('\n\n');
    content = `${content.replace(/\s*$/, '')}\n\n${tail}\n`;
  }
  return { content, results, baselines };
}
