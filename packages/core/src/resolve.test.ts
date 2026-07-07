import { describe, expect, it } from 'vitest';
import { resolve, RegistryError } from './resolve.js';
import { Agent, WorkspaceManifest } from './domain/schema/workspace.js';

const manifest = (over: Partial<Record<string, unknown>> = {}) =>
  WorkspaceManifest.parse({ version: 1, providers: ['claude'], agents: [], ...over });

const agent = (id: string, name = id) =>
  Agent.parse({ id, name, description: `${name} agent`, body: 'do things' });

describe('resolve — custom agents', () => {
  it('auto-includes a custom agent even when the manifest lists none', () => {
    const ws = resolve(manifest({ agents: [] }), { customAgents: [agent('security-reviewer')] });
    expect(ws.agents.map((a) => a.value.id)).toEqual(['security-reviewer']);
    expect(ws.agents[0]?.provenance.source).toBe('manifest');
  });

  it('lets a custom file OVERRIDE a built-in of the same id', () => {
    const ws = resolve(manifest({ agents: ['architect'] }), { customAgents: [agent('architect', 'My Architect')] });
    const architect = ws.agents.find((a) => a.value.id === 'architect');
    expect(architect?.value.name).toBe('My Architect'); // the file won, not the built-in
    expect(architect?.provenance.source).toBe('manifest');
  });

  it('still resolves built-in agents from the manifest', () => {
    const ws = resolve(manifest({ agents: ['architect'] }));
    expect(ws.agents.map((a) => a.value.id)).toEqual(['architect']);
    expect(ws.agents[0]?.provenance.source).toBe('registry');
  });

  it('throws a clear RegistryError for an unknown manifest agent', () => {
    expect(() => resolve(manifest({ agents: ['does-not-exist'] }))).toThrow(RegistryError);
  });
});
