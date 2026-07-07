# Architecture

How `ai-workspace` is put together, in diagrams. For the *why* behind the two hardest
parts, see [merge-engine.md](./merge-engine.md) and
[provider-capability-matrix.md](./provider-capability-matrix.md).

The whole system has one job: keep **one** settings file (`.ai/workspace.json`) as the
source of truth, and project it into the specific files each AI tool expects — safely,
every time.

---

## 1. The big picture

Two packages. `core` is the **brain** (pure logic, never touches the disk). `cli` is the
**hands** (commands + all file I/O). The brain is easy to test because it's just
input → output; all the messy real-world stuff is quarantined in the hands.

```mermaid
flowchart TD
    U["You (developer)"] --> CLI["CLI entry — cac"]

    subgraph SHELL["@ai-workspace/cli — the hands (does I/O)"]
        CMD["Commands: init · generate · diff"]
        PIPE["pipeline — orchestrates the run"]
        FS["fs-shell — read / write / hash / lockfile"]
        AL["agents-loader — reads .ai/agents/*.md"]
    end

    subgraph CORE["@ai-workspace/core — the brain (pure, no I/O)"]
        RES["resolve — manifest to canonical model"]
        ADAPT["adapters — claude, copilot"]
        MERGE["merge — the 11-row state table"]
        REG["regions — merge marked blocks"]
        STRUCT["structured — merge JSON by key"]
        SCHEMA["schema — zod data shapes"]
    end

    CLI --> CMD
    CMD --> PIPE
    PIPE --> FS
    PIPE --> AL
    PIPE --> RES
    PIPE --> ADAPT
    PIPE --> MERGE
    PIPE --> REG
    PIPE --> STRUCT
    RES --> SCHEMA
    ADAPT --> SCHEMA
    FS -->|reads / writes| DISK["Your files: CLAUDE.md · .claude/ · .github/ · .mcp.json"]

    classDef pure fill:#e6f4ea,stroke:#137333,color:#0b3d1c;
    classDef shell fill:#e8f0fe,stroke:#1a56db,color:#12306b;
    class RES,ADAPT,MERGE,REG,STRUCT,SCHEMA pure;
    class CMD,PIPE,FS,AL shell;
```

**The one rule that holds it together:** arrows only ever point *from* `cli` *into*
`core`, never the other way. The brain doesn't know the hands exist.

---

## 2. What happens when you run `generate`

Follow one command end to end. Notice the shape: the shell *reads*, asks the pure core to
*decide*, then the shell *writes*.

```mermaid
sequenceDiagram
    actor User
    participant CLI as CLI generate
    participant Pipe as pipeline shell
    participant Core as core pure
    participant FS as filesystem

    User->>CLI: ai-workspace generate
    CLI->>Pipe: runGenerate(root)
    Pipe->>FS: read .ai/workspace.json
    FS-->>Pipe: manifest text
    Pipe->>FS: read .ai/agents/*.md
    FS-->>Pipe: custom agents
    Pipe->>Core: resolve(manifest, customAgents)
    Core-->>Pipe: CanonicalWorkspace (concrete)
    Pipe->>Core: adapter.plan(ws) per provider
    Core-->>Pipe: planned writes + diagnostics

    loop each planned file
        Pipe->>FS: read file on disk + baseline from lockfile
        FS-->>Pipe: disk + base
        Pipe->>Core: decide (state table / regions / structured)
        Core-->>Pipe: action + resolved content
        Pipe->>FS: write (skipped if noop / keep / dry-run)
    end

    Pipe->>FS: write updated lockfile
    Pipe-->>User: outcomes + notices
```

`diff` is the *exact same* sequence with the writes turned off — that's why what `diff`
shows always matches what `generate` does.

---

## 3. The merge decision (why your edits survive)

For every file, the engine compares three things — **base** (what it wrote last time),
**disk** (what's there now), **new** (what it wants now) — and picks an action. This is
the safety mechanism in one picture:

```mermaid
flowchart TD
    Start(["a planned file"]) --> Q1{"tracked in<br/>lockfile?"}

    Q1 -->|no| Q2{"file exists<br/>on disk?"}
    Q2 -->|no| Create["create"]
    Q2 -->|"yes, identical"| AdoptNoop["noop — adopt"]
    Q2 -->|"yes, differs"| ConflictNew["conflict"]

    Q1 -->|yes| Q3{"file exists<br/>on disk?"}
    Q3 -->|no| Restore["restore"]
    Q3 -->|yes| Q4{"did you edit it?<br/>(disk vs base)"}

    Q4 -->|no| Q5{"new output<br/>differs from base?"}
    Q5 -->|no| Noop5["noop"]
    Q5 -->|yes| Update["update"]

    Q4 -->|yes| Q6{"compare new output"}
    Q6 -->|"new == base"| Keep["keep your edit"]
    Q6 -->|"new == your edit"| Noop8["noop — converged"]
    Q6 -->|"both changed"| Conflict9["conflict"]

    classDef safe fill:#e6f4ea,stroke:#137333,color:#0b3d1c;
    classDef danger fill:#fce8e6,stroke:#c5221f,color:#5c1512;
    class Create,AdoptNoop,Restore,Noop5,Update,Keep,Noop8 safe;
    class ConflictNew,Conflict9 danger;
```

**Green = it acts safely. Red = it stops and asks you** (never overwrites your work).
Files that were tracked but are no longer wanted follow a parallel path: `orphan-remove`
if you never touched them, `orphan-keep` if you did.

---

## 4. Three kinds of file, three merge strategies

One state table, but a "unit" means something different per file type — because you can't
merge a Markdown file the way you merge JSON.

```mermaid
flowchart LR
    Plan["a planned write"] --> K{"ownership?"}
    K -->|full| Full["whole file is ours<br/>e.g. .claude/agents/x.md<br/>→ compare the entire file"]
    K -->|regions| Regions["marked blocks + your prose<br/>e.g. CLAUDE.md<br/>→ merge each block, keep prose"]
    K -->|structured| Structured["JSON we share with you<br/>e.g. .mcp.json<br/>→ set only our keys, keep yours"]
```

---

## 5. How the packages fit together

```mermaid
flowchart LR
    subgraph mono["monorepo — npm workspaces"]
        cli["@ai-workspace/cli<br/>commands + I/O"]
        core["@ai-workspace/core<br/>pure logic + schema"]
    end
    cli -->|imports| core
    core -->|bundled by| build["tsup"]
    cli -->|bundled by| build
    build --> dist["dist/index.js<br/>one self-contained file, needs only Node"]
    dist --> team["installed by your team<br/>npm i -D github:org/ai-workspace"]
```

During development you run the TypeScript directly with `tsx`. To ship, `tsup` bundles
both packages (and every dependency) into a single `dist/index.js` a teammate can run with
nothing but Node. See the README's "For your team" section.

---

## 6. The canonical data model

This is the shape `resolve()` produces and every adapter consumes. It's the *union* of
what all providers can express; each adapter projects the parts its target supports.

```mermaid
classDiagram
    class CanonicalWorkspace {
      +ProviderId[] providers
      +Instruction[] instructions
      +Rule[] rules
      +Agent[] agents
      +Command[] commands
      +McpServer[] mcp
    }
    class Instruction {
      +string id
      +string title
      +string body
      +number priority
    }
    class Rule {
      +string id
      +string title
      +string[] globs
      +string body
    }
    class Agent {
      +string id
      +string name
      +ModelTier model
      +string[] tools
      +string body
    }
    class Command {
      +string id
      +string name
      +string body
    }
    class McpServer {
      +string id
      +string transport
    }
    CanonicalWorkspace o-- Instruction
    CanonicalWorkspace o-- Rule
    CanonicalWorkspace o-- Agent
    CanonicalWorkspace o-- Command
    CanonicalWorkspace o-- McpServer
```

Each item also carries **provenance** (did it come from the manifest, a registry artifact,
or a `.ai/agents/*.md` file?) so `diff` and clean-uninstall can trace every generated line
back to its source.

---

## 7. The distribution layer (shared catalog)

The team curates a **catalog** (a Git repo of artifact files + packs). A project selects
from it via `manifest.use`; `expandUse` unfolds packs and pulls dependencies; the result
feeds the same `resolve → generate` pipeline as everything else.

```mermaid
flowchart LR
    repo["Shared catalog — Git repo<br/>agents / rules / prompts / mcp / packs"]
    repo -->|clone or pull to cache| src["RegistrySource<br/>GitRegistry or LocalRegistry"]
    src -->|load| cat["Catalog — in memory"]
    man["manifest.use<br/>agent:x, pack:y"] --> exp["expandUse — pure<br/>packs + deps + cycle check"]
    cat --> exp
    exp --> res["resolve → CanonicalWorkspace"]
    res --> gen["generate → AI tool files"]
```

The `RegistrySource` port is the seam: `GitRegistry` (clone/pull to `.ai/cache/registry/`)
and `LocalRegistry` (read a folder) implement it today; an HTTP or private-registry
backend would be a third implementation with no other changes. `add`/`remove` simply edit
`manifest.use`; the merge engine's orphan logic makes `remove` a precise, clean uninstall.

## Design principles at a glance

| Principle | Where it shows up |
|---|---|
| Functional core / imperative shell | `core` is pure; all I/O lives in `cli` |
| Ports & adapters | `ProviderAdapter` is the port; `claude.ts` / `copilot.ts` are adapters |
| Single responsibility | one concern per file (`merge`, `regions`, `structured`, `resolve`) |
| One source of truth | `.ai/workspace.json` drives everything; the rest is generated |
| Deterministic output | stable ordering + idempotent regeneration (state-table row 5) |
| Fail loud, never silent | lossy/unsupported projections emit diagnostics; conflicts stop the run |
