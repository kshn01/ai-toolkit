import path from 'node:path';
import pc from 'picocolors';
import { readManifest } from '../infra/manifest.js';
import { openRegistry } from '../infra/registry.js';

/** `search <query>` — find catalog artifacts/packs by id or description. */
export async function searchCmd(query: string | undefined, opts: { cwd?: string } = {}): Promise<void> {
  const root = path.resolve(opts.cwd ?? process.cwd());
  const manifest = await readManifest(root);
  const registry = openRegistry(manifest.registry, root);
  if (!registry) throw new Error('no catalog configured — add "registry": { "url": "…" } to .ai/workspace.json');
  const catalog = await registry.load();
  const installed = new Set(manifest.use);

  const q = (query ?? '').toLowerCase();
  const hit = (ref: string, desc: string) => !q || ref.toLowerCase().includes(q) || desc.toLowerCase().includes(q);

  type Row = { ref: string; desc: string };
  const rows: Row[] = [
    ...catalog.artifacts.map((a) => ({ ref: `${a.kind}:${a.value.id}`, desc: describe(a) })),
    ...catalog.packs.map((p) => ({ ref: `pack:${p.id}`, desc: p.description })),
  ]
    .filter((r) => hit(r.ref, r.desc))
    .sort((a, b) => a.ref.localeCompare(b.ref));

  if (!rows.length) {
    console.log(pc.dim(`no matches for "${query ?? ''}"`));
    return;
  }
  const width = Math.max(...rows.map((r) => r.ref.length));
  for (const r of rows) {
    const mark = installed.has(r.ref) ? pc.green(' ✓') : '  ';
    console.log(`${mark} ${pc.cyan(r.ref.padEnd(width))}  ${pc.dim(r.desc)}`);
  }
  console.log(pc.dim(`\n${rows.length} result(s). ✓ = already installed. Add with \`ai-workspace add <ref>\`.`));
}

function describe(a: { kind: string; value: { description?: string; title?: string; name?: string } }): string {
  return a.value.description ?? a.value.title ?? a.value.name ?? '';
}
