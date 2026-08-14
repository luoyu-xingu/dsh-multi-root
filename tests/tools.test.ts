/**
 * Tool tests: the model-facing tools operate on the global root set attached
 * through the GUI. The execution context is a minimal fake of the registry's
 * ToolRunContext — the tools no longer read session state, so the fake only
 * satisfies the call signature.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { workspaceRootGlobTool, workspaceRootListTool, workspaceRootReadTool, workspaceRootsTool, workspaceRootWriteTool } from '../src/tools.ts'
import { MultiRootStore } from '../src/store.ts'

let dir: string
let root: string
let store: MultiRootStore

/** A minimal ToolRunContext (the tools ignore it beyond the signature). */
function fakeExec(): ToolRunContext {
  return {
    callId: 'call-1' as never,
    rootCallId: 'call-1' as never,
    name: 'workspace_roots',
    arguments: {},
    signal: new AbortController().signal,
    token: Symbol('token') as never,
    deferContext: () => {},
    concludeTurn: () => {},
  } as unknown as ToolRunContext
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-multi-root-tools-'))
  root = join(dir, 'extra')
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'a.txt'), 'alpha')
  store = new MultiRootStore(join(dir, 'store.json'))
  await store.add({ name: 'extra', path: root })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('agent tools', () => {
  it('workspace_roots lists the attached roots', async () => {
    const tool = workspaceRootsTool(store)
    const value = await tool.execute({}, fakeExec()) as { roots: Array<{ name: string; path: string; status: string }>; error?: string }
    expect(value.error).toBeUndefined()
    expect(value.roots).toHaveLength(1)
    expect(value.roots[0]).toMatchObject({ name: 'extra', path: root, status: 'ok' })

    const blocks = tool.output.render({}, value)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
    if (blocks[0].type === 'text') expect(blocks[0].text).toContain('extra')
  })

  it('read / list / glob operate through the root reference', async () => {
    const read = await workspaceRootReadTool(store).execute({ root: 'extra', path: 'src/a.txt' }, fakeExec()) as { content: string; error?: string }
    expect(read.error).toBeUndefined()
    expect(read.content).toBe('alpha')

    const list = await workspaceRootListTool(store).execute({ root: 'extra', path: 'src' }, fakeExec()) as { entries: Array<{ name: string }>; error?: string }
    expect(list.error).toBeUndefined()
    expect(list.entries.map(entry => entry.name)).toEqual(['a.txt'])

    const glob = await workspaceRootGlobTool(store).execute({ root: 'extra', pattern: '**/*.txt' }, fakeExec()) as { matches: string[]; error?: string }
    expect(glob.error).toBeUndefined()
    expect(glob.matches).toEqual(['src/a.txt'])

    // Unknown root reference fails closed with a structured error.
    const miss = await workspaceRootReadTool(store).execute({ root: 'nope', path: 'x' }, fakeExec()) as { error?: string }
    expect(miss.error).toMatch(/no attached root/)
  })

  it('write creates files inside the root and refuses escapes', async () => {
    const write = await workspaceRootWriteTool(store).execute({ root: 'extra', path: 'out/b.txt', content: 'beta' }, fakeExec()) as { ok: boolean; error?: string }
    expect(write.error).toBeUndefined()
    expect(write.ok).toBe(true)

    const escape = await workspaceRootWriteTool(store).execute({ root: 'extra', path: '../escape.txt', content: 'x' }, fakeExec()) as { ok: boolean; error?: string }
    expect(escape.ok).toBe(false)
    expect(escape.error).toMatch(/escape/)
  })

  it('classifies only the read-only tools as concurrency-safe', () => {
    expect(workspaceRootsTool(store).isConcurrencySafe?.({})).toBe(true)
    expect(workspaceRootReadTool(store).isConcurrencySafe?.({ root: 'extra', path: 'x' })).toBe(true)
    expect(workspaceRootListTool(store).isConcurrencySafe?.({ root: 'extra' })).toBe(true)
    expect(workspaceRootGlobTool(store).isConcurrencySafe?.({ root: 'extra', pattern: '**' })).toBe(true)
    expect(workspaceRootWriteTool(store).isConcurrencySafe).toBeUndefined()
  })
})
