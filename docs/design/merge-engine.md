# Merge Engine — the trust layer

This is what makes the tool "not a template generator." It lets `generate`/`sync`/`update`
run any number of times without ever destroying edits made by the user (or by an AI
assistant) to generated files. If this is right, everything else is mechanical. If it's
wrong, nobody runs the tool twice.

Types live in [lockfile.ts](../../packages/core/src/domain/schema/lockfile.ts); the pure
logic is in [merge.ts](../../packages/core/src/merge.ts),
[regions.ts](../../packages/core/src/regions.ts), and
[structured.ts](../../packages/core/src/structured.ts).

> **Implementation status.** Rows 1–11, all three ownership modes, region markers, the
> blob cache, and orphan cleanup are **built and tested**. Not yet built (design intent,
> flagged inline below): automatic three-way `diff3` merge on row 9, a formatting step,
> interactive conflict prompts, and the `sync`/`update`/`doctor`/`remove` commands. Today
> a row-9 divergence is reported as a `conflict` and left for you to resolve by hand.

## Three inputs, three hashes

For every planned write the engine compares three things:

| Symbol | Meaning | Source |
|---|---|---|
| **B** (base) | content as the tool last generated it | lockfile hash + `.ai/cache/blobs/<hash>` |
| **D** (disk) | content currently on disk | filesystem |
| **N** (new) | content the resolver+adapter want now | `adapter.plan()` |

The lockfile stores only the **hash** of B (fast). The full B **content** is cached in
`.ai/cache/blobs/` so a real three-way merge is possible when D and N both diverged.

## The state table

Every decision reduces to comparing B, D, N. This table is the whole engine:

| # | Condition | Action | Writes? |
|---|---|---|---|
| 1 | no lock entry, D absent | `create` | yes |
| 2 | no lock entry, D present, D==N | `noop` (adopt) | no |
| 3 | no lock entry, D present, D≠N | `conflict` (untracked pre-existing file) | resolve |
| 4 | lock exists, D absent, — | `restore` (user deleted; manifest still wants it) | yes + warn |
| 5 | D==B, N==B | `noop` | **no** |
| 6 | D==B, N≠B | `update` (safe overwrite) | yes |
| 7 | D≠B, N==B | `keep` (upstream unchanged; preserve user edit) | no |
| 8 | D≠B, N==D | `noop` (converged — user edit matches new output) | no |
| 9 | D≠B, N≠B, N≠D | **today:** `conflict` (left for manual resolution). **planned:** `diff3(D, B, N)` → clean ⇒ `merge`, overlap ⇒ `conflict` | resolve |
| 10 | lock entry, not in current plan, D==B | `orphan-remove` (clean uninstall) | delete |
| 11 | lock entry, not in current plan, D≠B | `orphan-keep` (user-edited orphan) | no + warn |

**Row 5 is the idempotency guarantee.** With no manifest/registry change, every file hits
row 5 → zero writes, zero lockfile churn. `generate && generate` is a no-op by construction.

## Ownership modes — the table applies per unit

- **full** — the unit is the whole file. Table applies once.
- **regions** — the unit is each managed region. Table applies per region; text *outside*
  every marker is user territory and is **never** hashed, compared, or touched.
- **structured** (JSON/TOML) — **do not** run diff3 on structured data (textually merging
  JSON produces garbage). Instead: the lockfile records which top-level keys we own. Merge
  = deep-set our keys into the parsed on-disk object, leave all other keys untouched,
  re-serialize. Conflict only if the user hand-edited a key *we own* to differ from B.

## Managed-region markers

For `regions` files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`):

```md
<!-- ai-workspace:begin id=instruction:coding-style -->
…generated content…
<!-- ai-workspace:end id=instruction:coding-style -->
```

Rules (as built):
- Comment syntax matches the file type (`<!-- -->` for markdown/HTML).
- The marker carries only the region `id`. Each region's baseline **hash** lives in the
  lockfile (not inline), and its baseline **content** in `.ai/cache/blobs/` — that's the
  three-way base for that region.
- Regions are emitted in a **deterministic order** (by `priority`, then `id`) so output is stable.
- If a region's markers are missing (user deleted them) → row 4 `restore`: re-insert at the
  deterministic position. Never duplicate.
- Everything between the end of one region and the start of the next is user prose — preserved verbatim.

## Formatting before hashing — *planned*

> Not yet implemented — there is no formatter in the pipeline today. Documented here as
> the intended design so it isn't reinvented wrong later.

If a formatter (e.g. Prettier) is ever added, it must run *before* hashing. Otherwise the
next run sees formatter-mutated bytes ≠ stored hash → a false "user edited" on row 7/9,
breaking idempotency. The rule would be **render → format → hash → write**, so the stored
hash always matches the exact bytes on disk.

## Conflict resolution (rows 3, 9)

**As built:** on a conflict the engine writes nothing to that file (your content is left
exactly as-is), records it in the outcome list, prints `✗ N conflict(s)`, and the process
**exits non-zero** so CI notices. You resolve it by making the file and the settings agree,
then re-running `generate`.

**Planned:** an interactive `@clack` prompt per conflict (keep mine / take theirs / merge),
and a `--force` flag to take the generated version unconditionally.

## Orphan handling = clean uninstall

Remove a provider or an artifact from the manifest (or delete a `.ai/agents/*.md` file) →
its files/regions vanish from the plan → rows 10/11 fire. Unedited orphans are deleted;
user-edited orphans are kept. This is why the lockfile tracks provenance: the engine knows
*exactly* which files a given artifact created, so removal is precise, not a guess.

## Dry-run / diff is the same engine

`ai-workspace diff` runs the entire pipeline through the state table and prints the outcomes
**without writing** (`runGenerate(root, { dryRun: true })`). There is one merge engine;
`generate` and `diff` are the same call with a different write flag. Planned commands
(`doctor`, `sync`, `update`, `remove`) would be further thin callers of it.

## Test obligations (this module earns the paranoia)

Covered today by [merge.test.ts](../../packages/core/src/merge.test.ts),
[regions.test.ts](../../packages/core/src/regions.test.ts), and
[structured.test.ts](../../packages/core/src/structured.test.ts):
- Each of the 11 rows has a fixture; the `keep` regression (stable across repeated regens) is pinned.
- Region-preservation: user prose between regions survives byte-for-byte across a regen.
- Structured merge: an unrelated user key in `.mcp.json` survives an mcp-server update.
- *(Planned)* formatter-idempotency, once a formatter exists.
