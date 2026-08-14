/**
 * Fs-ops tests: the containment boundary of the multi-root plugin. Traversal
 * attempts, symlinked escapes, roundtrips, and caps are exercised against a
 * real sandbox directory tree (never the plugin's own files).
 */

import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FsOpsError,
  browseDirs,
  canonicalizeRootPath,
  globInRoot,
  isPathInside,
  joinRel,
  listDir,
  readTextFile,
  resolveRootRef,
  workspaceKeyOf,
  writeTextFile,
} from '../src/fs-ops.ts'
import { MultiRootStore } from '../src/store.ts'

let dir: string
let store: MultiRootStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-multi-root-ops-'))
  store = new MultiRootStore(join(dir, 'store.json'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('joinRel / isPathInside', () => {
  it('rejects traversal and absolute paths before touching the disk', () => {
    const root = join(dir, 'root')
    expect(() => joinRel(root, '../escape.txt')).toThrow(FsOpsError)
    expect(() => joinRel(root, 'a/../../escape.txt')).toThrow(FsOpsError)
    expect(() => joinRel(root, '..')).toThrow(FsOpsError)
    expect(() => joinRel(root, '')).toThrow(FsOpsError)
    expect(() => joinRel(root, join(dir, 'abs.txt'))).toThrow(FsOpsError)
    expect(() => joinRel(root, 'a\\..\\b.txt')).toThrow(FsOpsError)
    expect(joinRel(root, 'a/b.txt')).toBe(join(root, 'a', 'b.txt'))
  })

  it('compares prefixes case-insensitively on win32', () => {
    const root = join(dir, 'Root')
    expect(isPathInside(root, join(root, 'child'))).toBe(true)
    if (process.platform === 'win32') {
      expect(isPathInside(join(dir, 'root'), join(dir, 'ROOT', 'child'))).toBe(true)
    } else {
      expect(isPathInside(join(dir, 'root'), join(dir, 'ROOT', 'child'))).toBe(false)
    }
    expect(isPathInside(join(dir, 'rootA'), join(dir, 'rootB'))).toBe(false)
  })
})

describe('workspace key and root attachment', () => {
  it('canonicalizes existing directories and degrades for missing ones', async () => {
    const ws = join(dir, 'ws')
    await mkdir(ws)
    // realpath is the canonical spelling (long form even when tmpdir()
    // returns the 8.3 short form on Windows).
    expect(await workspaceKeyOf(ws)).toBe(await realpath(ws))
    const missing = join(dir, 'missing')
    expect(await workspaceKeyOf(missing)).toBe(missing)
  })

  it('canonicalizeRootPath validates existence and rejects the workspace itself', async () => {
    const ws = join(dir, 'ws')
    await mkdir(ws)
    const other = join(dir, 'other')
    await mkdir(other)
    await expect(canonicalizeRootPath(ws, ws)).rejects.toThrow(FsOpsError)
    await expect(canonicalizeRootPath(ws, join(dir, 'nope'))).rejects.toThrow(FsOpsError)
    const file = join(dir, 'plain.txt')
    await writeFile(file, 'x')
    await expect(canonicalizeRootPath(ws, file)).rejects.toThrow(FsOpsError)
    const ok = await canonicalizeRootPath(ws, other)
    expect(ok.path).toBe(await realpath(other))
    expect(ok.name).toBe('other')
  })

  it('resolves roots by id first, then by name', async () => {
    const ws = join(dir, 'ws')
    await mkdir(ws)
    const a = await store.add(ws, { name: 'same', path: '/p/a' })
    const b = await store.add(ws, { name: 'same', path: '/p/b' })
    // Exact id wins over the shared name.
    expect((await resolveRootRef(store, ws, a.id)).path).toBe('/p/a')
    expect((await resolveRootRef(store, ws, b.id)).path).toBe('/p/b')
    // The shared name resolves to the first match.
    expect((await resolveRootRef(store, ws, 'same')).path).toBe('/p/a')
    await expect(resolveRootRef(store, ws, 'nope')).rejects.toThrow(FsOpsError)
  })
})

describe('read / write / list / glob roundtrips', () => {
  let root: string

  beforeEach(async () => {
    root = join(dir, 'root')
    await mkdir(join(root, 'src', 'nested'), { recursive: true })
    await writeFile(join(root, 'src', 'a.txt'), 'alpha')
    await writeFile(join(root, 'src', 'nested', 'b.ts'), 'beta')
    await writeFile(join(root, 'readme.md'), '# hi')
  })

  it('reads and writes text with containment enforced', async () => {
    const read = await readTextFile(root, 'src/a.txt')
    expect(read).toEqual({ content: 'alpha', size: 5, truncated: false })

    const wrote = await writeTextFile(root, 'new/deep/file.txt', 'hello world')
    expect(wrote.bytes).toBe(11)
    expect(await readTextFile(root, 'new/deep/file.txt')).toMatchObject({ content: 'hello world' })

    await expect(readTextFile(root, '../escape')).rejects.toThrow(FsOpsError)
    await expect(writeTextFile(root, '../escape.txt', 'x')).rejects.toThrow(FsOpsError)
  })

  it('lists directories with dirs first and size on files', async () => {
    const listing = await listDir(root, 'src')
    expect(listing.entries.map(entry => entry.name)).toEqual(['nested', 'a.txt'])
    const nested = listing.entries[0]
    expect(nested.kind).toBe('directory')
    const file = listing.entries[1]
    expect(file.kind).toBe('file')
    expect(file.size).toBe(5)
    expect(listing.truncated).toBe(false)
    await expect(listDir(root, 'src/a.txt')).rejects.toThrow(FsOpsError)
  })

  it('globs across the root and refuses escaping patterns', async () => {
    const { matches } = await globInRoot(root, '**/*.{txt,ts,md}')
    expect(matches.sort()).toEqual(['readme.md', 'src/a.txt', 'src/nested/b.ts'])
    expect((await globInRoot(root, 'src/**')).truncated).toBe(false)
    await expect(globInRoot(root, '../*')).rejects.toThrow(FsOpsError)
    await expect(globInRoot(root, '/etc/*')).rejects.toThrow(FsOpsError)
  })

  it('browses directories for the picker', async () => {
    const result = await browseDirs(root)
    expect(result.path).toBe(root)
    expect(result.dirs.map(entry => entry.name)).toContain('src')
    const empty = await browseDirs(join(dir, 'missing'))
    expect(empty.dirs).toEqual([])
  })

  it('rejects symlinked escapes on read and write', async () => {
    const outside = join(dir, 'outside.txt')
    await writeFile(outside, 'secret')
    const outsideDir = join(dir, 'outsideDir')
    await mkdir(outsideDir)
    let linkCreated = false
    try {
      await symlink(outside, join(root, 'link.txt'))
      await symlink(outsideDir, join(root, 'linkdir'), 'dir')
      linkCreated = true
    } catch {
      // Windows without developer mode cannot create symlinks; skip the escape
      // assertions rather than failing the platform.
    }
    if (!linkCreated) return
    await expect(readTextFile(root, 'link.txt')).rejects.toThrow(FsOpsError)
    await expect(writeTextFile(root, 'linkdir/new.txt', 'x')).rejects.toThrow(FsOpsError)
  })
})
