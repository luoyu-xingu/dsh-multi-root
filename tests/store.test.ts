/**
 * Store tests: the durable persistence semantics of ~/.dsh/dsh-multi-root.json
 * (keyed by canonical workspace path) without touching the real home config.
 */

import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
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
  it('starts empty for an unknown workspace key', async () => {
    expect(await store.roots('/nonexistent/ws')).toEqual([])
  })

  it('adds, lists, removes roots per workspace key', async () => {
    const entry = await store.add('W1', { name: 'frontend', path: '/p/frontend' })
    expect(entry.id).toBeTruthy()
    expect(entry.createdAt).toBeGreaterThan(0)

    const roots = await store.roots('W1')
    expect(roots).toHaveLength(1)
    expect(roots[0]).toMatchObject({ name: 'frontend', path: '/p/frontend' })

    await store.add('W1', { name: 'backend', path: '/p/backend' })
    await store.add('W2', { name: 'docs', path: '/p/docs' })
    expect(await store.roots('W1')).toHaveLength(2)
    expect(await store.roots('W2')).toHaveLength(1)

    await store.remove('W1', entry.id)
    expect((await store.roots('W1')).map(root => root.name)).toEqual(['backend'])
    // Idempotent: removing again resolves without error.
    await store.remove('W1', entry.id)
  })

  it('rejects duplicate paths within one workspace', async () => {
    await store.add('W1', { name: 'a', path: '/p/a' })
    await expect(store.add('W1', { name: 'a2', path: '/p/a' })).rejects.toThrow(StoreError)
    // The same path under a different workspace key is allowed.
    await expect(store.add('W2', { name: 'a', path: '/p/a' })).resolves.toBeTruthy()
  })

  it('renames a root and stamps updatedAt', async () => {
    const entry = await store.add('W1', { name: 'old', path: '/p/a' })
    const renamed = await store.rename('W1', entry.id, 'new')
    expect(renamed.name).toBe('new')
    expect(renamed.updatedAt).toBeGreaterThanOrEqual(entry.updatedAt)
    expect((await store.roots('W1'))[0].name).toBe('new')
    await expect(store.rename('W1', 'nope', 'x')).rejects.toThrow(StoreError)
  })

  it('reorders roots only on an exact id set', async () => {
    const a = await store.add('W1', { name: 'a', path: '/p/a' })
    const b = await store.add('W1', { name: 'b', path: '/p/b' })
    const c = await store.add('W1', { name: 'c', path: '/p/c' })
    await store.reorder('W1', [c.id, a.id, b.id])
    expect((await store.roots('W1')).map(root => root.id)).toEqual([c.id, a.id, b.id])
    await expect(store.reorder('W1', [a.id, b.id])).rejects.toThrow(StoreError)
    await expect(store.reorder('W1', [a.id, b.id, 'nope'])).rejects.toThrow(StoreError)
  })

  it('persists across instances', async () => {
    await store.add('W1', { name: 'frontend', path: '/p/frontend' })
    const reloaded = new MultiRootStore(file)
    const roots = await reloaded.roots('W1')
    expect(roots).toHaveLength(1)
    expect(roots[0].name).toBe('frontend')
  })

  it('degrades to empty on a corrupt file', async () => {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, 'not json {', 'utf8')
    const corrupt = new MultiRootStore(file)
    expect(await corrupt.roots('W1')).toEqual([])
    // A subsequent mutation still persists a valid file.
    await corrupt.add('W1', { name: 'ok', path: '/p/ok' })
    const reloaded = new MultiRootStore(file)
    expect((await reloaded.roots('W1')).map(root => root.name)).toEqual(['ok'])
  })

  it('writes a valid JSON shape with version 1', async () => {
    await store.add('W1', { name: 'frontend', path: '/p/frontend' })
    const raw = JSON.parse(await readFile(file, 'utf8')) as { version: number; workspaces: Record<string, { roots: unknown[] }> }
    expect(raw.version).toBe(1)
    expect(raw.workspaces.W1.roots).toHaveLength(1)
  })
})
