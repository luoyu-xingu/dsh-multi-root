/**
 * Durable multi-root store: `~/.dsh/dsh-multi-root.json` holding one flat,
 * ordered list of roots. There is no primary-workspace concept — every root
 * is equal, and all agents see the same set.
 *
 * Durability discipline: the config directory is created 0700, the file is
 * written 0600 via a temp-file + rename atomic swap, and every mutation is
 * serialized through one promise chain so concurrent callers can never
 * interleave writes. A missing or unparseable file degrades to an empty
 * store (the roots are re-addable state, not secrets). Version-1 files
 * (per-workspace keyed) are migrated into the flat list on load.
 * @module @luoyu-xingu/dsh-multi-root/store
 */

import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { RootEntry } from './core/types.ts'

/** Current on-disk shape: one flat root list. */
interface StoreShape {
  version: 2
  roots: RootEntry[]
}

/** Version-1 shape: roots keyed by canonical workspace path. */
interface StoreShapeV1 {
  version: 1
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
  private shape: StoreShape = { version: 2, roots: [] }
  private readonly ready: Promise<void>
  private chain: Promise<void> = Promise.resolve()

  /** @param file - store file path (tests inject a sandbox path). */
  constructor(file: string = defaultStoreFile()) {
    this.file = file
    this.ready = this.load()
  }

  /** All roots in display order (empty when none are attached). */
  async list(): Promise<readonly RootEntry[]> {
    await this.ready
    return this.shape.roots
  }

  /** Add a pre-validated root entry (id/path resolved by the caller). */
  async add(entry: Omit<RootEntry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<RootEntry> {
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
      if (this.shape.roots.some(existing => existing.path === root.path)) {
        throw new StoreError('root-duplicate', `a root for this path is already attached: ${root.path}`)
      }
      this.shape.roots = [...this.shape.roots, root]
    })
    return root
  }

  /** Remove one root by id (idempotent; a missing id resolves without writing). */
  async remove(id: string): Promise<void> {
    await this.ready
    await this.mutate(() => {
      const roots = this.shape.roots.filter(root => root.id !== id)
      if (roots.length === this.shape.roots.length) return
      this.shape.roots = roots
    })
  }

  /** Rename one root (display alias only; the path never changes). */
  async rename(id: string, name: string): Promise<RootEntry> {
    await this.ready
    let renamed: RootEntry | undefined
    await this.mutate(() => {
      const target = this.shape.roots.find(root => root.id === id)
      if (target === undefined) throw new StoreError('root-unknown', `unknown root id: ${id}`)
      renamed = { ...target, name, updatedAt: Date.now() }
      this.shape.roots = this.shape.roots.map(root => root.id === id ? renamed! : root)
    })
    return renamed!
  }

  /** Reorder roots to the exact given id sequence (must match the current set). */
  async reorder(ids: readonly string[]): Promise<void> {
    await this.ready
    await this.mutate(() => {
      const current = this.shape.roots
      if (ids.length !== current.length || current.some(root => !ids.includes(root.id))) {
        throw new StoreError('reorder-invalid', 'reorder ids must match the current root set exactly')
      }
      const byId = new Map(current.map(root => [root.id, root]))
      this.shape.roots = ids.map(id => byId.get(id)!)
    })
  }

  /** Load the store file once (missing/corrupt degrades to empty; v1 migrates). */
  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) {
        const record = parsed as Record<string, unknown>
        if (record.version === 2 && Array.isArray(record.roots)) {
          this.shape = { version: 2, roots: record.roots as RootEntry[] }
        } else if (record.version === 1 && typeof record.workspaces === 'object' && record.workspaces !== null) {
          // Migrate: flatten the per-workspace lists into one deduped list.
          const seen = new Set<string>()
          const roots: RootEntry[] = []
          const states = record.workspaces as Record<string, { roots?: unknown }>
          for (const state of Object.values(states)) {
            if (!Array.isArray(state.roots)) continue
            for (const candidate of state.roots as RootEntry[]) {
              if (typeof candidate !== 'object' || candidate === null || typeof candidate.path !== 'string') continue
              if (seen.has(candidate.path)) continue
              seen.add(candidate.path)
              roots.push(candidate)
            }
          }
          this.shape = { version: 2, roots }
          // Persist the migrated shape once so later boots never re-migrate.
          // Best effort: a read-only file keeps the in-memory list anyway.
          await this.persist().catch(() => {})
        }
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
