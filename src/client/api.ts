/**
 * Wire client for the /api/dsh-multi-root route family. Plain fetch against
 * the same origin (the GUI is served by the same loopback webserver the
 * routes live on); failures surface as thrown Errors with the host message.
 * @module dsh-multi-root/client/api
 */

import { API } from '../invariant.ts'
import type { BrowseDir, RootView } from '../core/types.ts'

/** One browse listing: directories of a path plus the drive roster. */
export interface BrowseResult {
  path: string
  dirs: BrowseDir[]
  drives: BrowseDir[]
}

/** Typed envelope reader: the family returns `{ error }` on failure. */
async function request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const init: RequestInit = body === undefined
    ? { method: 'GET', credentials: 'same-origin' }
    : {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }
  const response = await fetch(path, init)
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error(`request failed: ${response.status}`)
  }
  if (!response.ok || (typeof payload === 'object' && payload !== null && 'error' in payload && (payload as { error: unknown }).error !== undefined)) {
    const message = typeof payload === 'object' && payload !== null && typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : `request failed: ${response.status}`
    throw new Error(message)
  }
  return payload as T
}

/** The panel's API surface. */
export class MultiRootApi {
  /** All attached roots (with live status). */
  async roots(): Promise<{ roots: RootView[] }> {
    return request<{ roots: RootView[] }>(API.roots)
  }

  /** Attach a folder to the global root set. */
  async add(path: string, name: string): Promise<{ root: RootView }> {
    return request<{ root: RootView }>(API.roots, { path, name })
  }

  /** Remove one root. */
  async remove(id: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(API.rootsRemove, { id })
  }

  /** Rename one root. */
  async rename(id: string, name: string): Promise<{ root: RootView }> {
    return request<{ root: RootView }>(API.rootsRename, { id, name })
  }

  /** Reorder roots to the given id sequence. */
  async reorder(ids: string[]): Promise<{ roots: RootView[] }> {
    return request<{ roots: RootView[] }>(API.rootsReorder, { ids })
  }

  /** Browse directories (the picker feed); empty path opens the drive level. */
  async browse(path: string): Promise<BrowseResult> {
    return request<BrowseResult>(API.browse, { path })
  }
}
