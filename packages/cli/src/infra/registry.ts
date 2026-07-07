/**
 * RegistrySource — where the shared catalog comes from. One interface, two backends:
 *
 *   LocalRegistry — reads a catalog folder straight off disk (also the dev/test path).
 *   GitRegistry   — clones/pulls a catalog repo into a cache, then reads it as local.
 *
 * `openRegistry()` picks the backend from the manifest's `registry.url`. Adding a new
 * backend later (HTTP, private registry) means implementing this interface — nothing
 * else changes. This is the "registry behind a port" seam.
 */

import { promises as fs, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  Agent,
  type Catalog,
  CatalogArtifact,
  CatalogPack,
  Command,
  friendlyError,
  McpServer,
  type RegistryConfig,
  Rule,
  Skill,
} from '@ai-workspace/core';
import { frontmatter, toStringArray } from './frontmatter.js';

const run = promisify(execFile);

export interface RegistrySource {
  load(): Promise<Catalog>;
}

const readDir = async (dir: string): Promise<string[]> => {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
};

const isDir = async (p: string): Promise<boolean> => {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
};

/** Read every file under `dir` into { path (relative, /-joined), content }. */
async function readTree(dir: string, base = dir): Promise<{ path: string; content: string }[]> {
  const out: { path: string; content: string }[] = [];
  for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await readTree(full, base)));
    else out.push({ path: path.relative(base, full).split(path.sep).join('/'), content: await fs.readFile(full, 'utf8') });
  }
  return out;
}

const mdFiles = (files: string[]) => files.filter((f) => f.endsWith('.md')).sort();

/** Reads `<dir>/{agents,rules,prompts,mcp,packs}` into a Catalog. */
export class LocalRegistry implements RegistrySource {
  constructor(private readonly dir: string) {}

  async load(): Promise<Catalog> {
    const artifacts: CatalogArtifact[] = [];
    const packs: CatalogPack[] = [];

    const wrap = (file: string, fn: () => CatalogArtifact) => {
      try {
        artifacts.push(fn());
      } catch (err) {
        throw new Error(`invalid catalog file ${file}:\n${friendlyError(err)}`);
      }
    };

    // agents/
    for (const file of mdFiles(await readDir(path.join(this.dir, 'agents')))) {
      const id = path.basename(file, '.md');
      const { data, body } = frontmatter(await fs.readFile(path.join(this.dir, 'agents', file), 'utf8'));
      wrap(`agents/${file}`, () =>
        CatalogArtifact.parse({
          kind: 'agent',
          version: data.version ?? '0.0.0',
          dependencies: toStringArray(data.dependencies),
          value: Agent.parse({
            id,
            name: data.name ?? id,
            description: data.description ?? '',
            model: data.model ?? 'default',
            tools: toStringArray(data.tools),
            body: body.trim(),
            priority: data.priority ?? 100,
          }),
        }),
      );
    }

    // rules/
    for (const file of mdFiles(await readDir(path.join(this.dir, 'rules')))) {
      const id = path.basename(file, '.md');
      const { data, body } = frontmatter(await fs.readFile(path.join(this.dir, 'rules', file), 'utf8'));
      wrap(`rules/${file}`, () =>
        CatalogArtifact.parse({
          kind: 'rule',
          version: data.version ?? '0.0.0',
          dependencies: toStringArray(data.dependencies),
          value: Rule.parse({
            id,
            title: data.title ?? id,
            body: body.trim(),
            globs: toStringArray(data.globs),
            alwaysApply: data.alwaysApply ?? false,
            priority: data.priority ?? 100,
          }),
        }),
      );
    }

    // prompts/  -> Command
    for (const file of mdFiles(await readDir(path.join(this.dir, 'prompts')))) {
      const id = path.basename(file, '.md');
      const { data, body } = frontmatter(await fs.readFile(path.join(this.dir, 'prompts', file), 'utf8'));
      wrap(`prompts/${file}`, () =>
        CatalogArtifact.parse({
          kind: 'prompt',
          version: data.version ?? '0.0.0',
          dependencies: toStringArray(data.dependencies),
          value: Command.parse({
            id,
            name: data.name ?? id,
            description: data.description,
            argumentHint: data['argument-hint'] ?? data.argumentHint,
            body: body.trim(),
          }),
        }),
      );
    }

    // mcp/  (JSON)
    for (const file of (await readDir(path.join(this.dir, 'mcp'))).filter((f) => f.endsWith('.json')).sort()) {
      const id = path.basename(file, '.json');
      const json = JSON.parse(await fs.readFile(path.join(this.dir, 'mcp', file), 'utf8')) as Record<string, unknown>;
      wrap(`mcp/${file}`, () =>
        CatalogArtifact.parse({
          kind: 'mcp',
          version: (json.version as string) ?? '0.0.0',
          dependencies: toStringArray(json.dependencies),
          value: McpServer.parse({ id, ...json }),
        }),
      );
    }

    // skills/<id>/  (a folder tree; SKILL.md frontmatter gives name/description)
    const skillsRoot = path.join(this.dir, 'skills');
    for (const id of (await readDir(skillsRoot)).sort()) {
      const skillDir = path.join(skillsRoot, id);
      if (!(await isDir(skillDir))) continue;
      const files = await readTree(skillDir);
      const skillMd = files.find((f) => f.path.toLowerCase() === 'skill.md');
      const { data } = skillMd ? frontmatter(skillMd.content) : { data: {} as Record<string, unknown> };
      wrap(`skills/${id}`, () =>
        CatalogArtifact.parse({
          kind: 'skill',
          version: (data.version as string) ?? '0.0.0',
          dependencies: toStringArray(data.dependencies),
          value: Skill.parse({
            id,
            name: (data.name as string) ?? id,
            description: (data.description as string) ?? '',
            files,
          }),
        }),
      );
    }

    // packs/  (YAML)
    for (const file of (await readDir(path.join(this.dir, 'packs'))).filter((f) => /\.(ya?ml)$/.test(f)).sort()) {
      const { data } = frontmatter(`---\n${await fs.readFile(path.join(this.dir, 'packs', file), 'utf8')}\n---\n`);
      try {
        packs.push(CatalogPack.parse({ id: data.id ?? path.basename(file).replace(/\.(ya?ml)$/, ''), ...data }));
      } catch (err) {
        throw new Error(`invalid catalog pack packs/${file}:\n${friendlyError(err)}`);
      }
    }

    return { artifacts, packs };
  }
}

/** Clones/updates a catalog repo into a cache dir, then reads it with LocalRegistry. */
export class GitRegistry implements RegistrySource {
  constructor(
    private readonly url: string,
    private readonly ref: string,
    private readonly cacheDir: string,
  ) {}

  private async ensureCheckout(): Promise<void> {
    const git = (args: string[], cwd?: string) => run('git', args, cwd ? { cwd } : undefined);
    if (existsSync(path.join(this.cacheDir, '.git'))) {
      await git(['fetch', '--all', '--tags', '--prune'], this.cacheDir);
    } else {
      await fs.mkdir(path.dirname(this.cacheDir), { recursive: true });
      await git(['clone', this.url, this.cacheDir]);
    }
    await git(['checkout', this.ref], this.cacheDir);
    // best-effort fast-forward if ref is a branch
    await git(['pull', '--ff-only'], this.cacheDir).catch(() => undefined);
  }

  async load(): Promise<Catalog> {
    try {
      await this.ensureCheckout();
    } catch (err) {
      throw new Error(`could not fetch catalog from ${this.url} (ref ${this.ref}): ${(err as Error).message}`);
    }
    return new LocalRegistry(this.cacheDir).load();
  }
}

/** A short, filesystem-safe slug of a URL for the cache dir name. */
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60);

/** Pick a backend from the manifest's registry config. Undefined => no catalog configured. */
export function openRegistry(config: RegistryConfig | undefined, root: string): RegistrySource | undefined {
  if (!config) return undefined;
  const local = config.url.replace(/^file:\/\//, '');
  const looksRemote = /^(https?|git|ssh):\/\//.test(config.url) || config.url.startsWith('git@') || config.url.endsWith('.git');
  // A plain existing directory (not a remote URL) is read in place — no clone.
  if (!looksRemote && existsSync(local)) return new LocalRegistry(local);
  return new GitRegistry(config.url, config.ref, path.join(root, '.ai', 'cache', 'registry', slug(config.url)));
}
