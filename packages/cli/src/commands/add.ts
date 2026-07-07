import path from 'node:path';
import pc from 'picocolors';
import { readManifest, writeManifest } from '../infra/manifest.js';
import { openRegistry } from '../infra/registry.js';

/** `add <ref...>` — add catalog refs (e.g. agent:x, pack:y) to the manifest's `use` list. */
export async function addCmd(refs: string[], opts: { cwd?: string } = {}): Promise<void> {
  const root = path.resolve(opts.cwd ?? process.cwd());
  if (!refs?.length) {
    throw new Error('nothing to add — e.g. `ai-workspace add agent:security-reviewer pack:frontend-team`');
  }

  const manifest = await readManifest(root);
  const registry = openRegistry(manifest.registry, root);
  if (!registry) {
    throw new Error('no catalog configured — add "registry": { "url": "…" } to .ai/workspace.json');
  }
  const catalog = await registry.load();

  const known = new Set<string>([
    ...catalog.artifacts.map((a) => `${a.kind}:${a.value.id}`),
    ...catalog.packs.map((p) => `pack:${p.id}`),
  ]);
  const unknown = refs.filter((r) => !known.has(r));
  if (unknown.length) {
    throw new Error(`not in catalog: ${unknown.join(', ')}\ntry \`ai-workspace search <term>\` to find valid refs.`);
  }

  const use = new Set(manifest.use);
  const added = refs.filter((r) => !use.has(r));
  added.forEach((r) => use.add(r));
  manifest.use = [...use].sort();
  await writeManifest(root, manifest);

  if (added.length) {
    console.log(pc.green(`✓ added ${added.length}:`));
    added.forEach((r) => console.log(`  + ${r}`));
  } else {
    console.log(pc.dim('• already present — nothing to add'));
  }
  console.log(pc.dim('\nrun `ai-workspace generate` to apply.'));
}
