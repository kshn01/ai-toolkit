import path from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { type ProviderId, WorkspaceManifest } from '@ai-workspace/core';
import { readIfExists, writeFileEnsured } from '../infra/fs-shell.js';
import { runGenerate } from '../pipeline.js';

/** Every provider we can offer. `ready:false` = user can pick it, but generate skips it for now. */
const PROVIDERS: { value: ProviderId; label: string; ready: boolean }[] = [
  { value: 'claude', label: 'Claude Code', ready: true },
  { value: 'cursor', label: 'Cursor', ready: false },
  { value: 'copilot', label: 'GitHub Copilot', ready: false },
  { value: 'gemini', label: 'Gemini CLI', ready: false },
  { value: 'codex', label: 'Codex', ready: false },
];

/** Turn the user's answers into a valid manifest object. */
function buildManifest(name: string, providers: ProviderId[]) {
  return WorkspaceManifest.parse({
    version: 1,
    name,
    providers,
    agents: ['architect'],
    instructions: [
      {
        id: 'coding-style',
        title: 'Coding Style',
        body: 'Prefer small, composable functions. Keep the domain layer free of I/O.',
        priority: 10,
      },
    ],
    rules: [
      {
        id: 'react',
        title: 'React conventions',
        body: 'Use function components and hooks. No class components.',
        globs: ['**/*.tsx'],
        priority: 20,
      },
    ],
    commands: [
      {
        id: 'review',
        name: 'review',
        description: 'Review the current diff for bugs',
        body: 'Review the staged changes and list any correctness bugs you find.',
      },
    ],
    mcp: [
      {
        id: 'filesystem',
        name: 'Filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
      },
    ],
  });
}

export async function initCmd(opts: { cwd?: string; yes?: boolean } = {}): Promise<void> {
  const root = path.resolve(opts.cwd ?? process.cwd());
  const target = path.join(root, '.ai', 'workspace.json');

  if (await readIfExists(target)) {
    console.log(pc.yellow('• .ai/workspace.json already exists — leaving it untouched'));
    return;
  }

  // No terminal to talk to (CI, piped input) or --yes? Use sensible defaults, no questions.
  const interactive = process.stdout.isTTY && !opts.yes;

  if (!interactive) {
    await writeFileEnsured(target, `${JSON.stringify(buildManifest('my-workspace', ['claude', 'copilot']), null, 2)}\n`);
    console.log(pc.green('✓ created .ai/workspace.json'));
    console.log(pc.dim('  next: ai-workspace generate'));
    return;
  }

  // --- interactive flow (create-next-app style) ---
  p.intro(pc.bgCyan(pc.black(' ai-workspace ')));

  const name = await p.text({
    message: 'Workspace name?',
    placeholder: 'my-workspace',
    defaultValue: 'my-workspace',
  });
  if (p.isCancel(name)) return p.cancel('Cancelled.');

  const providers = await p.multiselect({
    message: 'Which AI tools do you use?  (space to toggle, enter to confirm)',
    options: PROVIDERS.map((x) => ({
      value: x.value,
      label: x.label,
      hint: x.ready ? undefined : 'coming soon',
    })),
    initialValues: ['claude'] as ProviderId[],
    required: true,
  });
  if (p.isCancel(providers)) return p.cancel('Cancelled.');

  const manifest = buildManifest(name, providers as ProviderId[]);
  await writeFileEnsured(target, `${JSON.stringify(manifest, null, 2)}\n`);
  p.log.success(`created ${pc.cyan('.ai/workspace.json')}`);

  const runNow = await p.confirm({ message: 'Generate the files now?', initialValue: true });
  if (p.isCancel(runNow)) return p.outro('Done. Run `ai-workspace generate` when ready.');

  if (runNow) {
    const s = p.spinner();
    s.start('Generating…');
    const { outcomes } = await runGenerate(root);
    s.stop(`Generated ${outcomes.length} file(s).`);
    p.note(outcomes.map((o) => `${o.action.padEnd(8)} ${o.path}`).join('\n'), 'Files');
  }

  p.note(
    'Drop a markdown file in .ai/agents/<name>.md to add a custom agent — no code needed.',
    'Tip',
  );
  p.outro(pc.green('All set. ') + pc.dim('Edit .ai/workspace.json, then run `ai-workspace generate`.'));
}
