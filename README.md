# dsh-multi-root

Multi-root workspace plugin for the DeepSeek Harness web GUI: attach several
**independent folders** to DSH, manage them from a sidebar panel, and let
agents list / read / write / glob across every registered root through gated
host-side tools — a VS Code-style multi-root workspace for DSH.

All roots are equal: there is no primary-workspace distinction, and the set
is shared by every session and agent.

Hot-pluggable via a cordis profile bundle: no DSH source changes.

## Features

- Sidebar entry `Roots` (`多根`) toggling a management panel in the center column.
- Attach any number of folders (path input or a host directory browser that
  starts at the **drive level** on Windows — pick C:, D:, ... then drill
  down — and at the home directory on Linux/macOS, where Up reaches the
  filesystem root), with optional display aliases.
- Rename, remove, and reorder roots; each row shows live directory status
  (`available` / `directory missing`).
- Roots persist in `~/.dsh/dsh-multi-root.json` (directory `0700`, file
  `0600`, atomic write) — GUI and agents share the same store.
- Agent tools registered into the DSH tool pipeline:

  | Tool | Purpose |
  | --- | --- |
  | `workspace_roots` | List all attached roots (id, name, path, status). |
  | `workspace_root_list` | List one directory inside a root. |
  | `workspace_root_read` | Read a text file inside a root (256 KB cap, truncation reported). |
  | `workspace_root_write` | Write (create or overwrite) a text file inside a root; parent directories are created. |
  | `workspace_root_glob` | Glob-match files/directories inside a root (result-capped). |

- A system-prompt section announces the plugin and its tools to every agent
  (disable via `announceToAgent: false`; master switch `enabled`).
- Bilingual UI copy (zh / en), following the document language.

## Install & Launch

The plugin is a cordis bundle package activated in the **web profile**. Pick
one way to get it, then launch the GUI as described below.

### From npm (published release — any platform, recommended)

```sh
# 1. install the plugin into the web profile (pnpm semantics under the hood)
dsh plugin --profile web add @luoyu-xingu/dsh-multi-root

# 2. launch the web GUI (Ctrl+C stops it; --port overrides the default)
dsh web
```

Open the URL printed by `dsh web` (default `http://127.0.0.1:3080`). The
`Roots` (`多根`) entry appears in the sidebar — click it to attach folders.
Verify the install with `dsh plugin --profile web ls @luoyu-xingu/dsh-multi-root`.

Upgrade later:

```sh
dsh plugin --profile web update @luoyu-xingu/dsh-multi-root
dsh web   # restart
```

Remove:

```sh
dsh plugin --profile web remove @luoyu-xingu/dsh-multi-root
```

### From source (clone this repository)

```sh
git clone https://github.com/luoyu-xingu/dsh-multi-root.git
cd dsh-multi-root
pnpm install
pnpm build        # typechecks, then emits lib/ (node half + client bundle)

# install the local checkout into the web profile; file: installs a
# self-contained copy (no junction, no absolute path kept in node_modules)
dsh plugin --profile web add file:<absolute path to the checkout>
#   Windows example: dsh plugin --profile web add file:E:/dsh_plugins/dsh-multi-root

dsh web
```

Rebuilding after code changes — build, sync the fresh `lib/` into the
profile's self-contained copy, and restart:

```sh
pnpm build
# PowerShell:
Copy-Item lib\* $env:USERPROFILE\.dsh\profiles\web\node_modules\@luoyu-xingu\dsh-multi-root\lib\ -Recurse -Force
# bash:
cp -r lib/* ~/.dsh/profiles/web/node_modules/@luoyu-xingu/dsh-multi-root/lib/
dsh web   # restart
```

**Restart `dsh web` after install or after every rebuild** — the web profile
disables the cordis HMR service, so file changes are not hot-loaded; the host
also validates the bundle revision against the startup file hash, and a stale
process answers old revisions with 404 (`bundle script ... failed to load`).

## Usage

1. Click the sidebar `Roots` entry.
2. Attach folders with the path input or the `Browse` dialog (drive level
   first on Windows); optionally give each one an alias.
3. Ask the agent to work across folders — it will use `workspace_roots` to
   discover the roots and the other `workspace_root_*` tools to operate inside
   them.

## Security model

This plugin deliberately bypasses the DSH file sandbox: its operations run
with the host process permissions. The trust boundary is therefore the root
set itself, and it is enforced on every operation:

- Roots are only the directories the **user** attached in the GUI; agents can
  never attach or remove roots.
- Every path is joined root-relative, canonicalized with `fs.realpath`, and
  required to live inside the registered root. Path traversal (`..`,
  absolute paths, drive letters) and symlinked escapes are rejected on read
  and on write (the resolved parent directory is verified too).
- Globbing never follows symbolic links; read/write gates re-verify any path
  a match is later used for.
- Reads are capped at 256 KB, writes at 5 MB, listings at 500 entries, and
  glob results at 1000 matches — outputs stay bounded for the model.
- All `/api/dsh-multi-root/*` routes are loopback-only with browser
  same-origin markers, so LAN-exposed deployments cannot serve them.
- The store file holds no secrets, but is written `0600` atomically anyway.

Known limits: the tools run with the host user's permissions and consume real
disk — confirm with the user before overwriting an existing file. The
directory browser lists host directories (loopback-only by design, it is the
picker feed).

## Configuration

The host plugin accepts a schemastery-validated config (composition entry):

```yaml
multi-root:
  enabled: true          # master switch for routes, tools, prompt section
  announceToAgent: true  # system-prompt section announcing the plugin
  hotReload: true        # host half watches its own lib/ and re-mounts on rebuild
```

## Development

```sh
pnpm install
pnpm typecheck   # tsc -b (host/client programs) + test program
pnpm test        # vitest run (store / fs-ops / tools / client smoke)
pnpm build       # declaration emit + tsdown (lib/ node half + lib/client.js)
```

Layout: `src/index.ts` is the host half (store, routes, tools, prompt
section), `src/client/` the browser half (sidebar entry, panel), and
`src/core/` the shared types. The client bundle is a closure-factory artifact
for the GUI's `__ModuleLoader__` with a build-time purity gate (only the
platform seed modules may stay external).

## License

MIT
