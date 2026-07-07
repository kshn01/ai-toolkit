import { describe, expect, it } from 'vitest';
import { mergeRegions } from './regions.js';
import type { PlannedRegion } from './domain/schema/lockfile.js';

const prov = { source: 'manifest' as const };
const region = (id: string, content: string): PlannedRegion => ({ id, content, provenance: prov });

describe('mergeRegions', () => {
  it('creates a fresh file with markers around each region', () => {
    const { content, results } = mergeRegions({
      existing: undefined,
      planned: [region('a', 'Alpha')],
      priorBase: new Map(),
    });
    expect(content).toContain('<!-- ai-workspace:begin id=a -->');
    expect(content).toContain('Alpha');
    expect(results).toEqual([{ id: 'a', action: 'create' }]);
  });

  it('is a noop when nothing changed', () => {
    const first = mergeRegions({ existing: undefined, planned: [region('a', 'Alpha')], priorBase: new Map() });
    const { results } = mergeRegions({
      existing: first.content,
      planned: [region('a', 'Alpha')],
      priorBase: new Map([['a', 'Alpha']]),
    });
    expect(results).toEqual([{ id: 'a', action: 'noop' }]);
  });

  it('preserves user prose OUTSIDE the markers, and keeps a user edit INSIDE (upstream unchanged)', () => {
    const generated = mergeRegions({ existing: undefined, planned: [region('a', 'Alpha')], priorBase: new Map() }).content;
    const userEdited = `# My own heading\n\n${generated.replace('Alpha', 'Alpha (my note)')}\n\nMy trailing prose.`;

    const { content, results } = mergeRegions({
      existing: userEdited,
      planned: [region('a', 'Alpha')], // upstream identical to base
      priorBase: new Map([['a', 'Alpha']]),
    });

    expect(results).toEqual([{ id: 'a', action: 'keep' }]);
    expect(content).toContain('# My own heading'); // prose before survives
    expect(content).toContain('My trailing prose.'); // prose after survives
    expect(content).toContain('Alpha (my note)'); // user's in-region edit survives
  });

  it('updates a region when upstream changed and user did not edit', () => {
    const generated = mergeRegions({ existing: undefined, planned: [region('a', 'Alpha')], priorBase: new Map() }).content;
    const { content, results } = mergeRegions({
      existing: generated,
      planned: [region('a', 'Alpha v2')],
      priorBase: new Map([['a', 'Alpha']]),
    });
    expect(results).toEqual([{ id: 'a', action: 'update' }]);
    expect(content).toContain('Alpha v2');
  });

  it('removes an unedited region no longer planned (orphan), keeping surrounding prose', () => {
    const generated = mergeRegions({
      existing: undefined,
      planned: [region('a', 'Alpha'), region('b', 'Beta')],
      priorBase: new Map(),
    }).content;
    const withProse = `intro\n${generated}\noutro`;

    const { content, results } = mergeRegions({
      existing: withProse,
      planned: [region('a', 'Alpha')], // 'b' dropped
      priorBase: new Map([['a', 'Alpha'], ['b', 'Beta']]),
    });

    expect(results.find((r) => r.id === 'b')?.action).toBe('orphan-remove');
    expect(content).not.toContain('Beta');
    expect(content).toContain('Alpha');
    expect(content).toContain('intro');
    expect(content).toContain('outro');
  });
});
