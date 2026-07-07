import { describe, expect, it } from 'vitest';
import { decideOrphan, decidePlanned } from './merge.js';

describe('decidePlanned — the 11-row state table', () => {
  it('row 1: no base, no disk -> create', () => {
    expect(decidePlanned({ next: 'N' })).toEqual({ action: 'create', resolved: 'N' });
  });
  it('row 2: no base, disk equals next -> noop (adopt)', () => {
    expect(decidePlanned({ disk: 'N', next: 'N' })).toEqual({ action: 'noop' });
  });
  it('row 3: no base, disk differs -> conflict', () => {
    expect(decidePlanned({ disk: 'X', next: 'N' })).toEqual({ action: 'conflict' });
  });
  it('row 4: tracked, disk deleted -> restore', () => {
    expect(decidePlanned({ base: 'B', next: 'N' })).toEqual({ action: 'restore', resolved: 'N' });
  });
  it('row 5: disk==base, next==base -> noop (IDEMPOTENCY)', () => {
    expect(decidePlanned({ base: 'B', disk: 'B', next: 'B' })).toEqual({ action: 'noop' });
  });
  it('row 6: disk==base, next changed -> update', () => {
    expect(decidePlanned({ base: 'B', disk: 'B', next: 'N' })).toEqual({ action: 'update', resolved: 'N' });
  });
  it('row 7: user edited, upstream unchanged -> keep', () => {
    expect(decidePlanned({ base: 'B', disk: 'EDIT', next: 'B' })).toEqual({ action: 'keep' });
  });
  it('row 8: user edited to match new output -> noop (converged)', () => {
    expect(decidePlanned({ base: 'B', disk: 'N', next: 'N' })).toEqual({ action: 'noop' });
  });
  it('row 9: both diverged -> conflict', () => {
    expect(decidePlanned({ base: 'B', disk: 'EDIT', next: 'N' })).toEqual({ action: 'conflict' });
  });
});

describe('decideOrphan — rows 10-11', () => {
  it('row 10: unedited orphan -> orphan-remove', () => {
    expect(decideOrphan({ base: 'B', disk: 'B' })).toEqual({ action: 'orphan-remove' });
  });
  it('row 10: deleted orphan -> orphan-remove', () => {
    expect(decideOrphan({ base: 'B' })).toEqual({ action: 'orphan-remove' });
  });
  it('row 11: user-edited orphan -> orphan-keep', () => {
    expect(decideOrphan({ base: 'B', disk: 'EDIT' })).toEqual({ action: 'orphan-keep' });
  });
});

describe('regression: keep must be stable across repeated regens', () => {
  // The bug: recording disk (the edit) as the next base flips row 7 -> row 6 next run.
  // Baseline must stay the clean generated output, so keep repeats forever.
  it('keep, then keep again with baseline held at generated output', () => {
    const generated = 'B';
    const edited = 'B\n<!-- note -->';
    // run 1: base=generated, disk=edited, next=generated -> keep
    expect(decidePlanned({ base: generated, disk: edited, next: generated }).action).toBe('keep');
    // run 2: baseline was (correctly) held at `generated`, disk still edited -> keep again
    expect(decidePlanned({ base: generated, disk: edited, next: generated }).action).toBe('keep');
  });
});
