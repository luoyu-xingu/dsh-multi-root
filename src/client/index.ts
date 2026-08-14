/**
 * Browser-half entry for the dsh-multi-root plugin — runs inside the dsh web
 * GUI. Registers the locale dictionaries and mounts the two DOM surfaces: the
 * sidebar entry row (toggles the panel) and the management panel in the
 * center column, bound to the active session's cwd (the primary workspace).
 * Failure policy: DOM mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws.
 *
 * Export discipline: the /client surface carries what cordis loading needs
 * plus types only — all value exports stay internal.
 * @module dsh-multi-root/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { MultiRootApi } from './api.ts'
import { en, zh, type MultiRootKey } from './locales.ts'
import { mountPanel, type WorkspaceBinding } from './mount.tsx'
import { MultiRootPanel } from './panel/MultiRootPanel.tsx'
import { PanelController } from './panel/controller.ts'
import { mountSidebarEntry } from './sidebar-entry.ts'

/** Locale namespace this plugin owns. */
const NS = 'dsh-multi-root'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-multi-root surface copy. */
    'dsh-multi-root': MultiRootKey
  }
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['sessions', 'locale']

/** Type-only surface (export discipline: no value exports beyond the plugin contract). */
export type { MultiRootPanelProps } from './panel/MultiRootPanel.tsx'
export type { PanelSnapshot } from './panel/controller.ts'
export type { MultiRootKey } from './locales.ts'

/**
 * The active session's cwd, projected as a small observable. Switching
 * sessions re-renders the panel against the new primary workspace.
 */
class SessionWorkspaceBinding implements WorkspaceBinding {
  private value = ''
  private readonly listeners = new Set<() => void>()

  constructor(ctx: ClientContext) {
    const read = (): void => {
      const snapshot = ctx.sessions.list.getSnapshot()
      const sessionId = snapshot.current as SessionId | undefined
      const cwd = sessionId === undefined ? undefined : snapshot.byId[sessionId]?.cwd
      const next = typeof cwd === 'string' && cwd !== '' ? cwd : ''
      if (next === this.value) return
      this.value = next
      for (const listener of [...this.listeners]) listener()
    }
    this.unsubscribe = ctx.sessions.list.subscribe(read)
    read()
  }

  private readonly unsubscribe: () => void

  get(): string {
    return this.value
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  dispose(): void {
    this.unsubscribe()
  }
}

/**
 * Mount the locale dictionaries, the sidebar entry, and the panel.
 * @param ctx - client root context (sessions and locale services).
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-multi-root: dictionaries')

  const controller = new PanelController()
  const api = new MultiRootApi()
  const binding = new SessionWorkspaceBinding(ctx)
  const disposers: Array<() => void> = []
  try {
    disposers.push(mountSidebarEntry(controller))
    disposers.push(mountPanel(controller, api, binding))
  } catch (error) {
    // DOM failures degrade the panel, never the GUI.
    console.warn('[dsh-multi-root] mount failed:', error)
  }
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
    binding.dispose()
  }, 'dsh-multi-root: ui mounts')
}
