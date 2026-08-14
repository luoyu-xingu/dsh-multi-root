/**
 * Agent tools: the model-facing half of the multi-root workspace. Every tool
 * resolves the caller's session cwd (the primary workspace) and operates only
 * on roots the user attached to that workspace in the GUI. The GUI and the
 * agent share the same durable store, so a root attached in the panel is
 * immediately operable by any agent, and the agent cannot attach roots itself.
 * @module @luoyu-xingu/dsh-multi-root/tools
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { RootView } from './core/types.ts'
import { FsOpsError, globInRoot, listDir, readTextFile, resolveRootRef, toRootView, workspaceKeyOf, writeTextFile } from './fs-ops.ts'
import type { MultiRootStore } from './store.ts'

/** One text content block (the only render shape these tools emit). */
function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** The primary workspace key of the calling agent's session. */
async function workspaceOf(exec: ToolRunContext): Promise<string> {
  const cwd = exec.agent?.session.header.cwd
  if (typeof cwd !== 'string' || cwd === '') {
    throw new FsOpsError('workspace-unknown', 'this tool needs an agent session with a working directory')
  }
  return workspaceKeyOf(cwd)
}

/** Resolve one root reference for the calling session. */
async function rootOf(store: MultiRootStore, exec: ToolRunContext, ref: string) {
  const workspace = await workspaceOf(exec)
  const entry = await resolveRootRef(store, workspace, ref)
  return { workspace, entry }
}

/** The shared tool-config tail: no parallel overlap for the mutating write. */
function readOnlySafe(_args: unknown): boolean {
  return true
}

/**
 * List the roots attached to the current workspace, with the primary
 * workspace folder first.
 */
export function workspaceRootsTool(store: MultiRootStore): ToolDefinition {
  return defineTool({
    name: 'workspace_roots',
    description: 'List the folders (roots) attached to the current multi-root workspace: the primary workspace folder plus every extra root the user added in the GUI panel. Use the returned id or name with the other workspace_root_* tools. ' +
      'Triggers: multi-root workspace, attached folders, list project folders, which folders are mounted.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workspace: { type: 'string', required: true },
          roots: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                path: { type: 'string', required: true },
                status: { type: 'string', enum: ['ok', 'missing'], required: true },
                createdAt: { type: 'integer', required: true },
                updatedAt: { type: 'integer', required: true },
              },
            },
          },
          error: { type: 'string' },
        },
      },
      render: (_args, value: { workspace?: string; roots?: RootView[]; error?: string }) => {
        if (value.error !== undefined) return text(value.error)
        const roots = value.roots ?? []
        if (roots.length === 0) return text(`workspace: ${value.workspace ?? ''}\nno extra roots attached (use the GUI panel to attach folders)`)
        const rows = roots.map(root => [root.name, root.path, root.status].join(' | '))
        return text([`workspace: ${value.workspace ?? ''}`, 'name | path | status', '--- | --- | ---', ...rows].join('\n'))
      },
    },
    isConcurrencySafe: readOnlySafe,
    async execute(_args, exec) {
      try {
        const workspace = await workspaceOf(exec)
        const entries = await store.roots(workspace)
        const roots: RootView[] = []
        for (const entry of entries) roots.push(await toRootView(entry))
        return { workspace, roots }
      } catch (error) {
        return { workspace: '', roots: [], error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** List one directory of an attached root. */
export function workspaceRootListTool(store: MultiRootStore): ToolDefinition {
  return defineTool({
    name: 'workspace_root_list',
    description: 'List one directory inside an attached root of the current multi-root workspace. Use the root id or name from workspace_roots. ' +
      'Triggers: list folder contents, show directory, what files are in this project.',
    parameters: {
      root: { type: 'string', required: true, description: 'Root id or name from workspace_roots.' },
      path: { type: 'string', description: 'Directory path relative to the root (default: the root itself).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          path: { type: 'string', required: true },
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                kind: { type: 'string', enum: ['file', 'directory', 'other'], required: true },
                size: { type: 'integer', required: true },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value: { root?: string; path?: string; entries?: Array<{ name: string; kind: string; size: number }>; truncated?: boolean; error?: string }) => {
        if (value.error !== undefined) return text(value.error)
        const rows = (value.entries ?? []).map(entry => `${entry.kind === 'directory' ? 'd' : entry.kind === 'file' ? 'f' : '?'}  ${entry.name}${entry.kind === 'file' ? `  (${entry.size} bytes)` : ''}`)
        const tail = value.truncated === true ? '\n[listing truncated: more entries exist]' : ''
        return text([`root: ${value.root ?? ''}  path: ${value.path ?? ''}`, ...rows].join('\n') + tail)
      },
    },
    isConcurrencySafe: readOnlySafe,
    async execute(args, exec) {
      const empty = { root: args.root ?? '', path: args.path ?? '', entries: [], truncated: false }
      try {
        const { entry } = await rootOf(store, exec, args.root)
        const result = await listDir(entry.path, args.path ?? '')
        return { root: entry.name, path: args.path ?? '', ...result }
      } catch (error) {
        return { ...empty, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** Read one text file from an attached root. */
export function workspaceRootReadTool(store: MultiRootStore): ToolDefinition {
  return defineTool({
    name: 'workspace_root_read',
    description: 'Read a text file inside an attached root of the current multi-root workspace (size-capped, truncated when oversized). Use the root id or name from workspace_roots. ' +
      'Triggers: read a file in another project folder, open config/log/source outside the primary workspace.',
    parameters: {
      root: { type: 'string', required: true, description: 'Root id or name from workspace_roots.' },
      path: { type: 'string', required: true, description: 'File path relative to the root.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          path: { type: 'string', required: true },
          content: { type: 'string', required: true },
          size: { type: 'integer', required: true },
          truncated: { type: 'boolean', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value: { root?: string; path?: string; content?: string; size?: number; truncated?: boolean; error?: string }) => {
        if (value.error !== undefined) return text(value.error)
        const head = `root: ${value.root ?? ''}  path: ${value.path ?? ''}  size: ${value.size ?? 0} bytes${value.truncated === true ? '  [truncated]' : ''}`
        return text(`${head}\n${value.content ?? ''}`)
      },
    },
    isConcurrencySafe: readOnlySafe,
    async execute(args, exec) {
      const empty = { root: args.root ?? '', path: args.path ?? '', content: '', size: 0, truncated: false }
      try {
        const { entry } = await rootOf(store, exec, args.root)
        const result = await readTextFile(entry.path, args.path)
        return { root: entry.name, path: args.path, ...result }
      } catch (error) {
        return { ...empty, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** Write one text file inside an attached root. */
export function workspaceRootWriteTool(store: MultiRootStore): ToolDefinition {
  return defineTool({
    name: 'workspace_root_write',
    description: 'Write (create or overwrite) a text file inside an attached root of the current multi-root workspace. Parent directories are created. Confirm with the user before overwriting an existing file. Use the root id or name from workspace_roots. ' +
      'Triggers: write a file in another project folder, update config outside the primary workspace.',
    parameters: {
      root: { type: 'string', required: true, description: 'Root id or name from workspace_roots.' },
      path: { type: 'string', required: true, description: 'File path relative to the root.' },
      content: { type: 'string', required: true, description: 'The complete UTF-8 text to write.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          root: { type: 'string', required: true },
          path: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value: { ok?: boolean; root?: string; path?: string; bytes?: number; error?: string }) => text(value.error !== undefined
        ? value.error
        : `wrote ${value.root ?? ''}/${value.path ?? ''} (${value.bytes ?? 0} bytes)`),
    },
    async execute(args, exec) {
      const empty = { ok: false, root: args.root ?? '', path: args.path ?? '', bytes: 0 }
      try {
        const { entry } = await rootOf(store, exec, args.root)
        const result = await writeTextFile(entry.path, args.path, args.content)
        return { ok: true, root: entry.name, path: args.path, bytes: result.bytes }
      } catch (error) {
        return { ...empty, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}

/** Glob inside an attached root. */
export function workspaceRootGlobTool(store: MultiRootStore): ToolDefinition {
  return defineTool({
    name: 'workspace_root_glob',
    description: 'Glob-match files and directories inside an attached root of the current multi-root workspace (results are count-capped). Use the root id or name from workspace_roots. ' +
      'Triggers: find files across another project folder, search by filename pattern.',
    parameters: {
      root: { type: 'string', required: true, description: 'Root id or name from workspace_roots.' },
      pattern: { type: 'string', required: true, description: 'Glob pattern relative to the root (e.g. **/*.ts, src/**).' },
      maxResults: { type: 'integer', description: 'Result cap (default 200).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          pattern: { type: 'string', required: true },
          matches: { type: 'array', items: { type: 'string' }, required: true },
          truncated: { type: 'boolean', required: true },
          error: { type: 'string' },
        },
      },
      render: (_args, value: { root?: string; pattern?: string; matches?: string[]; truncated?: boolean; error?: string }) => {
        if (value.error !== undefined) return text(value.error)
        const matches = value.matches ?? []
        const tail = value.truncated === true ? '\n[matches truncated: more results exist]' : ''
        return text([`root: ${value.root ?? ''}  pattern: ${value.pattern ?? ''}`, `matches: ${matches.length}`, ...matches].join('\n') + tail)
      },
    },
    isConcurrencySafe: readOnlySafe,
    async execute(args, exec) {
      const empty = { root: args.root ?? '', pattern: args.pattern ?? '', matches: [], truncated: false }
      try {
        const { entry } = await rootOf(store, exec, args.root)
        const result = await globInRoot(entry.path, args.pattern, args.maxResults)
        return { root: entry.name, pattern: args.pattern, ...result }
      } catch (error) {
        return { ...empty, error: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}
