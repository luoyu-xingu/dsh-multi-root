/**
 * Wire client for the /api/dsh-multi-root route family. Plain fetch against
 * the same origin (the GUI is served by the same loopback webserver the
 * routes live on); failures surface as thrown Errors with the host message.
 * @module dsh-multi-root/client/api
 */

import { API } from '../invariant.ts'
import type { BrowseDir, RootView } from '../core/types.ts'

/** One browse listing. */
export interface BrowseResult {
  path: string
  dirs: BrowseDir[]
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
  /** Roots attached to one workspace (with live status). */
  async roots(workspace: string): Promise<{ workspace: string; roots: RootView[] }> {
    const query = encodeURIComponent(workspace)
    return request<{ workspace: string; roots: RootView[] }>(`${API.roots}?workspace=${query}`)
  }

  /** Attach a folder to one workspace. */
  async add(workspace: string, path: string, name: string): Promise<{ root: RootView }> {
    return request<{ root: RootView }>(API.roots, { workspace, path, name })
  }

  /** Remove one root. */
  async remove(workspace: string, id: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(API.rootsRemove, { workspace, id })
  }

  /** Rename one root. */
  async rename(workspace: string, id: string, name: string): Promise<{ root: RootView }> {
    return request<{ root: RootView }>(API.rootsRename, { workspace, id, name })
  }

  /** Reorder roots to the given id sequence. */
  async reorder(workspace: string, ids: string[]): Promise<{ roots: RootView[] }> {
    return request<{ roots: RootView[] }>(API.rootsReorder, { workspace, ids })
  }

  /** Browse directories (the picker feed). */
  async browse(path: string): Promise<BrowseResult> {
    return request<BrowseResult>(API.browse, { path })
  }
}
