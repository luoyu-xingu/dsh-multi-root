/**
 * Self hot reload for the host half. The dsh web boot registers the cordis
 * HMR service with an empty module root, so plugin code changes are NOT
 * watched by the built-in machinery — patch-row edits hot-apply, but a
 * rebuilt lib/ would keep serving the cached ESM module. This module closes
 * that gap: it registers its own config watches (through the HMR service's
 * public `registerConfig`) on the plugin's own built files, and on a change
 * clears the Node module caches, disposes the plugin entry, and re-mounts it
 * from the fresh build. A failed re-mount restores the previous module cache
 * and resurrects the old instance, so a broken build never strands the GUI.
 *
 * The reload is scheduled outside the HMR refresh task on purpose: the
 * entry disposal runs this plugin's disposers, which await the HMR
 * registration's in-flight refresh task — awaiting that task from inside
 * itself would deadlock, so the refresh callback only schedules and returns.
 * @module @luoyu-xingu/dsh-multi-root/hmr
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

/** The HMR service surface this module consumes (undocumented internals kept local). */
interface HmrServiceLike {
  registerConfig(filename: string, refresh: () => Promise<void>): Promise<() => Promise<void>>
}

/** One loader entry: the plugin's own row in the include tree. */
interface EntryLike {
  options: { name?: string }
  disabled?: boolean
  _dispose(): Promise<void>
  refresh(): Promise<void>
}

/** The loader surface (with the exposed Node module cache when available). */
interface LoaderLike {
  internal?: { loadCache: Map<string, unknown> }
  entries(): Iterable<EntryLike>
}

/**
 * Watch this plugin's built host-half files and re-mount in place on change.
 * No-op outside a boot with the HMR service and exposed loader internals.
 * @param ctx - the plugin's host context.
 */
export function installSelfHotReload(ctx: Context): void {
  const hmr = ctx.get('hmr') as HmrServiceLike | undefined
  const loader = ctx.get('loader') as LoaderLike | undefined
  if (hmr === undefined || loader === undefined || loader.internal === undefined) return

  const here = fileURLToPath(import.meta.url)
  const files = [here, join(dirname(here), 'invariant.js')]
  const require = createRequire(import.meta.url)

  const findEntry = (): EntryLike | undefined => {
    // The profile row may carry this package under its plain name or under a
    // versioned alias (the `-live` deployment name used to dodge the module
    // cache pin), so match every row whose name belongs to this package.
    for (const entry of loader.entries()) {
      const name = entry.options?.name
      if (typeof name === 'string' && name.startsWith('@luoyu-xingu/dsh-multi-root')) return entry
    }
    return undefined
  }

  const reload = async (): Promise<void> => {
    const entry = findEntry()
    if (entry === undefined || entry.disabled) return
    const loadCache = loader.internal!.loadCache
    const urls = files.map(file => pathToFileURL(file).href)
    const esmBackup: Array<[string, unknown]> = []
    const cjsBackup: Array<[string, unknown]> = []
    for (const url of urls) {
      const cached = Map.prototype.get.call(loadCache, url)
      if (cached !== undefined) esmBackup.push([url, cached])
      Map.prototype.delete.call(loadCache, url)
    }
    for (const file of files) {
      const cached = require.cache[file] as NodeModule | undefined
      if (cached !== undefined) {
        cjsBackup.push([file, cached])
        delete require.cache[file]
      }
    }
    const restore = (): void => {
      for (const [url, job] of esmBackup) Map.prototype.set.call(loadCache, url, job)
      for (const [file, module] of cjsBackup) require.cache[file] = module as NodeModule
    }
    try {
      await entry._dispose()
    } catch (error) {
      restore()
      ctx.logger?.warn('[dsh-multi-root] dispose before reload failed:', error)
      return
    }
    try {
      await entry.refresh()
      ctx.logger?.info('[dsh-multi-root] host half hot reloaded')
    } catch (error) {
      // The new build failed to mount: restore the old modules and resurrect
      // the previous instance so the running GUI keeps working.
      ctx.logger?.warn('[dsh-multi-root] reload failed, restoring the previous build:', error)
      restore()
      try {
        await entry.refresh()
      } catch (second) {
        ctx.logger?.warn('[dsh-multi-root] restoring the previous build failed:', second)
      }
    }
  }

  /** Serialize reloads; coalesce bursts of file events into one pass. */
  let chain: Promise<void> = Promise.resolve()
  let dirty = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  const runPass = async (): Promise<void> => {
    while (dirty) {
      dirty = false
      await reload()
    }
  }
  const schedule = (): void => {
    dirty = true
    if (settleTimer !== undefined) return
    // A short settle window merges a multi-file sync (index.js + invariant.js
    // written back to back) into one reload instead of two dispose/register
    // cycles with a route-less gap in between.
    settleTimer = setTimeout(() => {
      settleTimer = undefined
      chain = chain.then(runPass, runPass)
    }, 400)
  }

  ctx.effect(async () => {
    const disposers = await Promise.all(files.map(file => hmr.registerConfig(file, async () => { schedule() })))
    return async () => {
      await Promise.all(disposers.map(dispose => dispose()))
    }
  }, 'dsh-multi-root: self hot reload')
}
