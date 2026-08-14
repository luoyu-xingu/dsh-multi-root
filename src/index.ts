/**
 * @luoyu-xingu/dsh-multi-root — host half. Mounts the durable roots store
 * (~/.dsh/dsh-multi-root.json), the /api/dsh-multi-root route family
 * (loopback-only), the agent tools (workspace_roots, workspace_root_list,
 * workspace_root_read, workspace_root_write, workspace_root_glob), and a
 * system-prompt announcement. The browser half (./client) renders the sidebar
 * entry and the management panel. Everything rides the official NPM SDK —
 * no dsh source changes.
 * @module @luoyu-xingu/dsh-multi-root
 */

import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { installSelfHotReload } from './hmr.ts'
import { GUIDANCE, PLUGIN_NAME, SECTION_ORDER } from './invariant.ts'
import { makeRoutes } from './routes.ts'
import { MultiRootStore } from './store.ts'
import {
  workspaceRootGlobTool,
  workspaceRootListTool,
  workspaceRootReadTool,
  workspaceRootsTool,
  workspaceRootWriteTool,
} from './tools.ts'

/** Stable cordis plugin name (the bundle row id). */
export const name = PLUGIN_NAME

/** Services required before the multi-root surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /**
   * When true (default), a system-prompt section announces the plugin to
   * every agent (tools + roots store). Set false to keep it silent.
   */
  announceToAgent?: boolean
  /** Master switch for the plugin (routes, tools, prompt section). */
  enabled?: boolean
  /**
   * When true (default), the host half watches its own built lib files and
   * re-mounts in place on rebuild (no dsh web restart). No-op in boots
   * without the HMR service.
   */
  hotReload?: boolean
}

export const Config: z<Config> = z.object({
  announceToAgent: z.boolean().default(true),
  enabled: z.boolean().default(true),
  hotReload: z.boolean().default(true),
})

/**
 * Mount the store, routes, tools, and announcement.
 * @param ctx - host plugin context carrying webServer/tools/systemPrompt.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export function apply(ctx: Context, config?: Config): void {
  const enabled = config?.enabled ?? true
  if (!enabled) return

  const store = new MultiRootStore()
  const tools = [
    workspaceRootsTool(store),
    workspaceRootListTool(store),
    workspaceRootReadTool(store),
    workspaceRootWriteTool(store),
    workspaceRootGlobTool(store),
  ]
  const routes = makeRoutes(store)

  if (config?.hotReload ?? true) installSelfHotReload(ctx)

  if (config?.announceToAgent ?? true) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: 'plugin:dsh-multi-root',
      order: SECTION_ORDER,
      text: GUIDANCE,
    }), 'dsh-multi-root: prompt section')
  }
  ctx.effect(() => {
    const disposers = routes.map(route => ctx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-multi-root: routes')
  ctx.effect(() => {
    const disposers = tools.map(tool => ctx.tools.register(tool))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-multi-root: tools')
}
