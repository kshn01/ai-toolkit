import { parse as parseYaml } from 'yaml';

/** Split `---\n...\n---\nbody` into parsed YAML frontmatter + the remaining body. */
export function frontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };
  return { data: (parseYaml(m[1] ?? '') ?? {}) as Record<string, unknown>, body: m[2] ?? '' };
}

/** Accept `x: [a, b]`, `x: a, b`, or missing — always return a string[]. */
export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}
