/**
 * Store tests: the durable persistence semantics of ~/.dsh/dsh-multi-root.json
 * (one flat, ordered root list) without touching the real home config.
 */

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MultiRootStore, StoreError } from '../src/store.ts'

let dir: string
let file: string
let store: MultiRootStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-multi-root-'))
  file = join(dir, 'config', 'store.json')
  store = new MultiRootStore(file)
})

afterEach(() => {
  // Best-effort cleanup of the sandbox tree.
  void import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))
})

describe('MultiRootStore', () => {
  it('starts empty', async () => {
    expect(await store.list()).toEqual([])
  })

  it('adds, lists, removes roots in order', async () => {
    const entry = await store.add({ name: 'frontend', path: '/p/frontend' })
    expect(entry.id).toBeTruthy()
    expect(entry.createdAt).toBeGreaterThan(0)

    expect(await store.list()).toHaveLength(1)

    await store.add({ name: 'backend', path: '/p/backend' })
    expect((await store.list()).map(root => root.name)).toEqual(['frontend', 'backend'])

    await store.remove(entry.id)
    expect((await store.list()).map(root => root.name)).toEqual(['backend'])
    // Idempotent: removing again resolves without error.
    await store.remove(entry.id)
  })

  it('rejects duplicate paths', async () => {
    await store.add({ name: 'a', path: '/p/a' })
    await expect(store.add({ name: 'a2', path: '/p/a' })).rejects.toThrow(StoreError)
  })

  it('renames a root and stamps updatedAt', async () => {
    const entry = await store.add({ name: 'old', path: '/p/a' })
    const renamed = await store.rename(entry.id, 'new')
    expect(renamed.name).toBe('new')
    expect(renamed.updatedAt).toBeGreaterThanOrEqual(entry.updatedAt)
    expect((await store.list())[0].name).toBe('new')
    await expect(store.rename('nope', 'x')).rejects.toThrow(StoreError)
  })

  it('reorders roots only on an exact id set', async () => {
    const a = await store.add({ name: 'a', path: '/p/a' })
    const b = await store.add({ name: 'b', path: '/p/b' })
    const c = await store.add({ name: 'c', path: '/p/c' })
    await store.reorder([c.id, a.id, b.id])
    expect((await store.list()).map(root => root.id)).toEqual([c.id, a.id, b.id])
    await expect(store.reorder([a.id, b.id])).rejects.toThrow(StoreError)
    await expect(store.reorder([a.id, b.id, 'nope'])).rejects.toThrow(StoreError)
  })

  it('persists across instances', async () => {
    await store.add({ name: 'frontend', path: '/p/frontend' })
    const reloaded = new MultiRootStore(file)
    const roots = await reloaded.list()
    expect(roots).toHaveLength(1)
    expect(roots[0].name).toBe('frontend')
  })

  it('degrades to empty on a corrupt file', async () => {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, 'not json {', 'utf8')
    const corrupt = new MultiRootStore(file)
    expect(await corrupt.list()).toEqual([])
    // A subsequent mutation still persists a valid file.
    await corrupt.add({ name: 'ok', path: '/p/ok' })
    const reloaded = new MultiRootStore(file)
    expect((await reloaded.list()).map(root => root.name)).toEqual(['ok'])
  })

  it('migrates a version-1 per-workspace file into the flat list', async () => {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({
      version: 1,
      workspaces: {
        '/ws1': { roots: [{ id: 'a', name: 'frontend', path: '/p/frontend', createdAt: 1, updatedAt: 1 }] },
        '/ws2': { roots: [
          { id: 'b', name: 'frontend-2', path: '/p/frontend', createdAt: 1, updatedAt: 1 },
          { id: 'c', name: 'backend', path: '/p/backend', createdAt: 1, updatedAt: 1 },
        ] },
      },
    }), 'utf8')
    const migrated = new MultiRootStore(file)
    const roots = await migrated.list()
    // Duplicate paths collapse across workspaces; order follows the file.
    expect(roots.map(root => root.name)).toEqual(['frontend', 'backend'])
    // The migrated shape persists as version 2.
    const raw = JSON.parse(await readFile(file, 'utf8')) as { version: number; roots: unknown[] }
    expect(raw.version).toBe(2)
  })

  it('writes a valid JSON shape with version 2', async () => {
    await store.add({ name: 'frontend', path: '/p/frontend' })
    const raw = JSON.parse(await readFile(file, 'utf8')) as { version: number; roots: unknown[] }
    expect(raw.version).toBe(2)
    expect(raw.roots).toHaveLength(1)
  })
})
