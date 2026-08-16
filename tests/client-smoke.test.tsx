/**
 * Client smoke test: the panel mounts and renders root rows against a
 * stubbed wire client. Light-mount assertion only — the full DOM wiring
 * (sidebar entry injection, center-column takeover) is shell territory and
 * stays outside the unit boundary.
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MultiRootApi } from '../src/client/api.ts'
import type { RootView } from '../src/core/types.ts'
import { MultiRootPanel } from '../src/client/panel/MultiRootPanel.tsx'
import { PanelController } from '../src/client/panel/controller.ts'

// jsdom act environment marker (React 18 requires it for act()).
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let cleanup: () => void

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  cleanup?.()
  container.remove()
})

/** One stubbed root row. */
function stubRoot(id: string, name: string, path: string): RootView {
  return { id, name, path, status: 'ok', createdAt: 1, updatedAt: 1 }
}

describe('MultiRootPanel', () => {
  it('renders the empty state when nothing is attached', async () => {
    const api = { roots: vi.fn(async () => ({ roots: [] })) } as unknown as MultiRootApi
    await act(async () => {
      const root = createRoot(container)
      root.render(<MultiRootPanel controller={new PanelController()} api={api} />)
      cleanup = () => { root.unmount() }
    })
    await vi.waitFor(() => {
      expect(container.textContent).toContain('多根工作区')
    })
    expect(api.roots).toHaveBeenCalledTimes(1)
  })

  it('renders attached roots', async () => {
    const roots = [stubRoot('r1', 'frontend', '/p/frontend'), stubRoot('r2', 'backend', '/p/backend')]
    const api = {
      roots: vi.fn(async () => ({ roots })),
    } as unknown as MultiRootApi
    await act(async () => {
      const root = createRoot(container)
      root.render(<MultiRootPanel controller={new PanelController()} api={api} />)
      cleanup = () => { root.unmount() }
    })
    await vi.waitFor(() => {
      expect(container.textContent).toContain('frontend')
      expect(container.textContent).toContain('backend')
    })
  })

  it('shows a structured load error when the host fails', async () => {
    const api = {
      roots: vi.fn(async () => { throw new Error('loopback-only') }),
    } as unknown as MultiRootApi
    await act(async () => {
      const root = createRoot(container)
      root.render(<MultiRootPanel controller={new PanelController()} api={api} />)
      cleanup = () => { root.unmount() }
    })
    await vi.waitFor(() => {
      expect(container.textContent).toContain('loopback-only')
    })
  })

  it('opens the browse dialog at the drive level', async () => {
    const api = {
      roots: vi.fn(async () => ({ roots: [] })),
      browse: vi.fn(async (path: string) => path === ''
        ? { path: '', dirs: [{ name: 'C:', path: 'C:\\' }, { name: 'D:', path: 'D:\\' }], drives: [{ name: 'C:', path: 'C:\\' }, { name: 'D:', path: 'D:\\' }], separator: '\\' }
        : { path, dirs: [], drives: [{ name: 'C:', path: 'C:\\' }], separator: '\\' }),
    } as unknown as MultiRootApi
    await act(async () => {
      const root = createRoot(container)
      root.render(<MultiRootPanel controller={new PanelController()} api={api} />)
      cleanup = () => { root.unmount() }
    })
    await act(async () => {
      const button = Array.from(container.querySelectorAll('button')).find(el => el.textContent === '浏览')
      expect(button).toBeDefined()
      button?.click()
    })
    await vi.waitFor(() => {
      expect(container.textContent).toContain('选择盘符')
      expect(container.textContent).toContain('C:')
      expect(container.textContent).toContain('D:')
    })
  })

  it('browses up to the filesystem root on POSIX', async () => {
    const calls: string[] = []
    const listings: Record<string, { path: string; dirs: Array<{ name: string; path: string }> }> = {
      '': { path: '/home/alice', dirs: [{ name: 'proj', path: '/home/alice/proj' }] },
      '/home/alice': { path: '/home/alice', dirs: [{ name: 'proj', path: '/home/alice/proj' }] },
      '/home': { path: '/home', dirs: [{ name: 'alice', path: '/home/alice' }] },
      '/': { path: '/', dirs: [{ name: 'usr', path: '/usr' }] },
    }
    const api = {
      roots: vi.fn(async () => ({ roots: [] })),
      browse: vi.fn(async (path: string) => {
        calls.push(path)
        const row = listings[path] ?? { path, dirs: [] }
        return { ...row, drives: [], separator: '/' }
      }),
    } as unknown as MultiRootApi
    await act(async () => {
      const root = createRoot(container)
      root.render(<MultiRootPanel controller={new PanelController()} api={api} />)
      cleanup = () => { root.unmount() }
    })
    await act(async () => {
      const button = Array.from(container.querySelectorAll('button')).find(el => el.textContent === '浏览')
      button?.click()
    })
    await vi.waitFor(() => {
      expect(container.textContent).toContain('/home/alice')
      expect(container.textContent).toContain('proj')
    })
    // Up: /home/alice -> /home -> / (the root must be reachable).
    await act(async () => {
      const up = Array.from(container.querySelectorAll('button')).find(el => el.textContent === '上一级')
      up?.click()
    })
    await vi.waitFor(() => {
      expect(calls).toContain('/home')
    })
    await act(async () => {
      const up = Array.from(container.querySelectorAll('button')).find(el => el.textContent === '上一级')
      up?.click()
    })
    await vi.waitFor(() => {
      // The root listing renders the `usr` directory (prefixed by the D icon).
      expect(container.textContent).toContain('usr')
      expect(calls).toContain('/')
    })
  })
})
