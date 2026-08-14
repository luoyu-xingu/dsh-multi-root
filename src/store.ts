/**
 * Durable multi-root store: `~/.dsh/dsh-multi-root.json` keyed by canonical
 * workspace path. The store owns persistence only — path validation and
 * canonicalization live in `fs-ops.ts`, so the store never touches the disk
 * beyond its own file.
 *
 * Durability discipline: the config directory is created 0700, the file is
 * written 0600 via a temp-file + rename atomic swap, and every mutation is
 * serialized through one promise chain so concurrent callers can never
 * interleave writes. A missing or unparseable file degrades to an empty
 * store (the roots are re-addable state, not secrets).
 * @module @luoyu-xingu/dsh-multi-root/store
 */

import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { RootEntry } from './core/types.ts'

/** On-disk shape. */
interface StoreShape {
  version: 1
  /** Canonical workspace path -> attached roots (in display order). */
  workspaces: Record<string, { roots: RootEntry[] }>
}

/** Default file location (the dsh-ssh convention: the user-private ~/.dsh). */
export function defaultStoreFile(): string {
  return join(homedir(), '.dsh', 'dsh-multi-root.json')
}

/** Error raised for store-level validation failures. */
export class StoreError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * The durable roots store. Load happens once at construction; every public
 * method awaits readiness first, so a slow disk can never race an early call.
 */
export class MultiRootStore {
  private readonly file: string
  private shape: StoreShape = { version: 1, workspaces: {} }
  private readonly ready: Promise<void>
  private chain: Promise<void> = Promise.resolve()

  /** @param file - store file path (tests inject a sandbox path). */
  constructor(file: string = defaultStoreFile()) {
    this.file = file
    this.ready = this.load()
  }

  /** Roots attached to one workspace, in display order (empty for unknown keys). */
  async roots(workspaceKey: string): Promise<readonly RootEntry[]> {
    await this.ready
    return this.shape.workspaces[workspaceKey]?.roots ?? []
  }

  /** Add a pre-validated root entry (id/name/path resolved by the caller). */
  async add(workspaceKey: string, entry: Omit<RootEntry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<RootEntry> {
    await this.ready
    const now = Date.now()
    const root: RootEntry = {
      id: entry.id ?? randomUUID(),
      name: entry.name,
      path: entry.path,
      createdAt: now,
      updatedAt: now,
    }
    await this.mutate(() => {
      const state = this.shape.workspaces[workspaceKey] ?? { roots: [] }
      if (state.roots.some(existing => existing.path === root.path)) {
        throw new StoreError('root-duplicate', `a root for this path is already attached: ${root.path}`)
      }
      this.shape.workspaces[workspaceKey] = { roots: [...state.roots, root] }
    })
    return root
  }

  /** Remove one root by id (idempotent; a missing id resolves without writing). */
  async remove(workspaceKey: string, id: string): Promise<void> {
    await this.ready
    await this.mutate(() => {
      const state = this.shape.workspaces[workspaceKey]
      if (state === undefined) return
      const roots = state.roots.filter(root => root.id !== id)
      if (roots.length === state.roots.length) return
      this.shape.workspaces[workspaceKey] = { roots }
    })
  }

  /** Rename one root (display alias only; the path never changes). */
  async rename(workspaceKey: string, id: string, name: string): Promise<RootEntry> {
    await this.ready
    let renamed: RootEntry | undefined
    await this.mutate(() => {
      const state = this.shape.workspaces[workspaceKey]
      if (state === undefined) throw new StoreError('root-unknown', `unknown root id: ${id}`)
      const target = state.roots.find(root => root.id === id)
      if (target === undefined) throw new StoreError('root-unknown', `unknown root id: ${id}`)
      renamed = { ...target, name, updatedAt: Date.now() }
      this.shape.workspaces[workspaceKey] = { roots: state.roots.map(root => root.id === id ? renamed! : root) }
    })
    return renamed!
  }

  /** Reorder roots to the exact given id sequence (must match the current set). */
  async reorder(workspaceKey: string, ids: readonly string[]): Promise<void> {
    await this.ready
    await this.mutate(() => {
      const state = this.shape.workspaces[workspaceKey]
      if (state === undefined && ids.length > 0) throw new StoreError('root-unknown', 'workspace has no roots to reorder')
      const current = state?.roots ?? []
      if (ids.length !== current.length || current.some(root => !ids.includes(root.id))) {
        throw new StoreError('reorder-invalid', 'reorder ids must match the current root set exactly')
      }
      if (state === undefined) return
      const byId = new Map(current.map(root => [root.id, root]))
      this.shape.workspaces[workspaceKey] = { roots: ids.map(id => byId.get(id)!) }
    })
  }

  /** Load the store file once (missing/corrupt degrades to empty). */
  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null && (parsed as StoreShape).version === 1) {
        this.shape = parsed as StoreShape
      }
    } catch {
      // Missing or unparseable: start empty. The file holds re-addable state.
    }
  }

  /** Serialize one mutation (memory update + atomic persist) behind the chain. */
  private mutate(update: () => void): Promise<void> {
    const run = async (): Promise<void> => {
      update()
      await this.persist()
    }
    // Chain regardless of the previous outcome: a failed persist must not
    // deadlock later mutations. Errors still surface to the awaiting caller.
    this.chain = this.chain.then(run, run)
    return this.chain
  }

  /** Atomic persist: tmp file + rename, directory 0700, file 0600. */
  private async persist(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(this.shape, null, 2), { mode: 0o600 })
    await rename(tmp, this.file)
    await chmod(this.file, 0o600).catch(() => {
      // Best effort on platforms without chmod semantics; the open mode above already applied.
    })
  }
}
