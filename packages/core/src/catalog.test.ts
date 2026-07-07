import { describe, expect, it } from 'vitest';
import { CatalogError, expandUse } from './catalog.js';
import type { Catalog } from './domain/schema/catalog.js';
import { Agent, Command, Rule, Skill } from './domain/schema/workspace.js';

const agent = (id: string, deps: string[] = []) => ({
  kind: 'agent' as const,
  version: '1.0.0',
  dependencies: deps,
  value: Agent.parse({ id, name: id, description: id, body: 'x' }),
});
const rule = (id: string) => ({
  kind: 'rule' as const,
  version: '1.0.0',
  dependencies: [],
  value: Rule.parse({ id, title: id, body: 'x' }),
});
const prompt = (id: string) => ({
  kind: 'prompt' as const,
  version: '1.0.0',
  dependencies: [],
  value: Command.parse({ id, name: id, body: 'x' }),
});

const skill = (id: string) => ({
  kind: 'skill' as const,
  version: '1.0.0',
  dependencies: [],
  value: Skill.parse({ id, name: id, description: id, files: [{ path: 'SKILL.md', content: 'do the thing' }] }),
});

const catalog = (over: Partial<Catalog> = {}): Catalog => ({
  artifacts: [agent('react-expert', ['rule:tailwind']), rule('tailwind'), prompt('pr-review'), agent('security'), skill('security-review')],
  packs: [
    { id: 'frontend-team', description: '', version: '1.0.0', use: ['agent:react-expert', 'prompt:pr-review'] },
    { id: 'everything', description: '', version: '1.0.0', use: ['pack:frontend-team', 'agent:security'] },
  ],
  ...over,
});

describe('expandUse', () => {
  it('resolves a single artifact and routes it by kind', () => {
    const out = expandUse(['agent:security'], catalog());
    expect(out.agents.map((a) => a.id)).toEqual(['security']);
    expect(out.rules).toEqual([]);
  });

  it('routes a skill (folder artifact) into the skills bucket', () => {
    const out = expandUse(['skill:security-review'], catalog());
    expect(out.skills.map((s) => s.id)).toEqual(['security-review']);
    expect(out.skills[0]?.files[0]?.path).toBe('SKILL.md');
  });

  it('pulls in dependencies automatically (react-expert needs tailwind)', () => {
    const out = expandUse(['agent:react-expert'], catalog());
    expect(out.agents.map((a) => a.id)).toEqual(['react-expert']);
    expect(out.rules.map((r) => r.id)).toEqual(['tailwind']); // dependency came along
  });

  it('expands a pack into its members', () => {
    const out = expandUse(['pack:frontend-team'], catalog());
    expect(out.agents.map((a) => a.id)).toContain('react-expert');
    expect(out.commands.map((c) => c.id)).toContain('pr-review');
    expect(out.rules.map((r) => r.id)).toContain('tailwind'); // via react-expert's dep
  });

  it('expands nested packs (a pack that includes a pack)', () => {
    const out = expandUse(['pack:everything'], catalog());
    const ids = [...out.agents, ...out.rules, ...out.commands].map((x) => x.id).sort();
    expect(ids).toEqual(['pr-review', 'react-expert', 'security', 'tailwind']);
  });

  it('dedupes when two selections share an artifact', () => {
    const out = expandUse(['agent:react-expert', 'pack:frontend-team'], catalog());
    expect(out.agents.filter((a) => a.id === 'react-expert')).toHaveLength(1);
  });

  it('throws a clear error for an unknown ref', () => {
    expect(() => expandUse(['agent:nope'], catalog())).toThrow(CatalogError);
  });

  it('detects a circular pack reference', () => {
    const cyclic = catalog({
      packs: [
        { id: 'a', description: '', version: '1.0.0', use: ['pack:b'] },
        { id: 'b', description: '', version: '1.0.0', use: ['pack:a'] },
      ],
    });
    expect(() => expandUse(['pack:a'], cyclic)).toThrow(/circular/i);
  });
});
