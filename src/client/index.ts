/**
 * Browser-half entry for the dsh-multi-root plugin — runs inside the dsh web
 * GUI. Registers the locale dictionaries and mounts the two DOM surfaces: the
 * sidebar entry row (toggles the panel) and the management panel in the
 * center column. The roots are global — no session binding needed.
 * Failure policy: DOM mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws.
 *
 * Export discipline: the /client surface carries what cordis loading needs
 * plus types only — all value exports stay internal.
 * @module @luoyu-xingu/dsh-multi-root/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { MultiRootApi } from './api.ts'
import { en, zh, type MultiRootKey } from './locales.ts'
import { mountPanel } from './mount.tsx'
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

/** Required services (fiber inject waiting — the locale service must be up). */
export const inject = ['locale']

/** Type-only surface (export discipline: no value exports beyond the plugin contract). */
export type { MultiRootPanelProps } from './panel/MultiRootPanel.tsx'
export type { PanelSnapshot } from './panel/controller.ts'
export type { MultiRootKey } from './locales.ts'

/**
 * Mount the locale dictionaries, the sidebar entry, and the panel.
 * @param ctx - client root context (locale service).
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-multi-root: dictionaries')

  const controller = new PanelController()
  const api = new MultiRootApi()
  const disposers: Array<() => void> = []
  try {
    disposers.push(mountSidebarEntry(controller))
    disposers.push(mountPanel(controller, api))
  } catch (error) {
    // DOM failures degrade the panel, never the GUI.
    console.warn('[dsh-multi-root] mount failed:', error)
  }
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
  }, 'dsh-multi-root: ui mounts')
}
