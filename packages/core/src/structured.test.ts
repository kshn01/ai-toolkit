import { describe, expect, it } from 'vitest';
import { mergeStructured } from './structured.js';

const entry = (id: string, value: unknown) => ({ id, value });

describe('mergeStructured', () => {
  it('creates the file with our owned entry', () => {
    const { content, action, ownedKeys } = mergeStructured({
      existing: undefined,
      root: 'mcpServers',
      entries: [entry('fs', { command: 'npx' })],
      priorKeys: [],
    });
    expect(action).toBe('create');
    expect(ownedKeys).toEqual(['fs']);
    expect(JSON.parse(content)).toEqual({ mcpServers: { fs: { command: 'npx' } } });
  });

  it("preserves a user's hand-added key that we don't own", () => {
    const existing = JSON.stringify({ mcpServers: { mine: { command: 'ha' } } }, null, 2) + '\n';
    const { content } = mergeStructured({
      existing,
      root: 'mcpServers',
      entries: [entry('fs', { command: 'npx' })],
      priorKeys: [],
    });
    const obj = JSON.parse(content);
    expect(obj.mcpServers.mine).toEqual({ command: 'ha' }); // survived
    expect(obj.mcpServers.fs).toEqual({ command: 'npx' }); // added
  });

  it('removes an owned key that is no longer planned, leaving others', () => {
    const existing = JSON.stringify({ mcpServers: { fs: { command: 'npx' }, mine: { command: 'ha' } } }, null, 2) + '\n';
    const { content, removed } = mergeStructured({
      existing,
      root: 'mcpServers',
      entries: [],
      priorKeys: ['fs'],
    });
    expect(removed).toEqual(['fs']);
    const obj = JSON.parse(content);
    expect(obj.mcpServers.fs).toBeUndefined();
    expect(obj.mcpServers.mine).toEqual({ command: 'ha' }); // untouched
  });

  it('signals file removal when nothing is left', () => {
    const existing = JSON.stringify({ mcpServers: { fs: { command: 'npx' } } }, null, 2) + '\n';
    const { action, content } = mergeStructured({ existing, root: 'mcpServers', entries: [], priorKeys: ['fs'] });
    expect(action).toBe('remove');
    expect(content).toBe('');
  });
});
