/**
 * The /api/dsh-multi-root route family: list/add/remove/rename/reorder the
 * roots attached to one workspace, plus the directory browse feed for the GUI
 * picker. Every route carries a loopback-only trust fence plus browser
 * same-origin markers — these endpoints read and attach host directories, so
 * LAN-exposed dsh web deployments must not serve them.
 * @module @luoyu-xingu/dsh-multi-root/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { API, MAX_JSON_BODY_BYTES } from './invariant.ts'
import { browseDirs, canonicalizeRootPath, toRootView, workspaceKeyOf } from './fs-ops.ts'
import { MultiRootStore } from './store.ts'

/**
 * Loopback literal check plus browser same-origin markers (the dsh-ssh
 * pairing-routes fence): only the user's own browser on this machine may call
 * the family, and cross-site fetches are refused outright.
 */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** URL query helper (first value, decoded). */
function queryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

/** Field reader: one required string field of a parsed body. */
function stringField(body: Record<string, unknown>, name: string): string {
  const value = body[name]
  return typeof value === 'string' ? value : ''
}

/**
 * Build every /api/dsh-multi-root route.
 * @param store - the durable roots store.
 * @returns the route family.
 */
export function makeRoutes(store: MultiRootStore): WebRoute[] {
  /** Guard helper: fence + method check. */
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  /** Error responder: store/ops failures become structured 400s. */
  const fail = (res: ServerResponse, error: unknown): void => {
    writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }

  const routes: WebRoute[] = [
    // --------------------------------------------------- roots (GET/POST)
    {
      kind: 'exact',
      path: API.roots,
      handler: async (req, res) => {
        const method = req.method ?? 'GET'
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (method === 'GET') {
          if (!isLoopbackRequest(req)) {
            writeJson(res, 403, { error: 'forbidden: loopback-only' })
            return
          }
          try {
            const workspace = await workspaceKeyOf(queryParam(url, 'workspace') ?? '')
            const entries = await store.roots(workspace)
            const roots = []
            for (const entry of entries) roots.push(await toRootView(entry))
            writeJson(res, 200, { workspace, roots })
          } catch (error) {
            fail(res, error)
          }
          return
        }
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (body === undefined) {
          writeJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        try {
          const workspace = await workspaceKeyOf(stringField(body, 'workspace'))
          const canonical = await canonicalizeRootPath(workspace, stringField(body, 'path'))
          const name = stringField(body, 'name')
          const entry = await store.add(workspace, { name: name !== '' ? name : canonical.name, path: canonical.path })
          writeJson(res, 201, { root: await toRootView(entry) })
        } catch (error) {
          fail(res, error)
        }
      },
    },
    // --------------------------------------------------- roots/remove
    {
      kind: 'exact',
      path: API.rootsRemove,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (body === undefined) {
          writeJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        try {
          const workspace = await workspaceKeyOf(stringField(body, 'workspace'))
          await store.remove(workspace, stringField(body, 'id'))
          writeJson(res, 200, { ok: true })
        } catch (error) {
          fail(res, error)
        }
      },
    },
    // --------------------------------------------------- roots/rename
    {
      kind: 'exact',
      path: API.rootsRename,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (body === undefined) {
          writeJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        try {
          const workspace = await workspaceKeyOf(stringField(body, 'workspace'))
          const entry = await store.rename(workspace, stringField(body, 'id'), stringField(body, 'name'))
          writeJson(res, 200, { root: await toRootView(entry) })
        } catch (error) {
          fail(res, error)
        }
      },
    },
    // --------------------------------------------------- roots/reorder
    {
      kind: 'exact',
      path: API.rootsReorder,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (body === undefined) {
          writeJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        try {
          const workspace = await workspaceKeyOf(stringField(body, 'workspace'))
          const raw = body.ids
          if (!Array.isArray(raw) || raw.some(id => typeof id !== 'string')) {
            writeJson(res, 400, { error: 'ids must be an array of root ids' })
            return
          }
          await store.reorder(workspace, raw as string[])
          const entries = await store.roots(workspace)
          const roots = []
          for (const entry of entries) roots.push(await toRootView(entry))
          writeJson(res, 200, { roots })
        } catch (error) {
          fail(res, error)
        }
      },
    },
    // --------------------------------------------------- browse
    {
      kind: 'exact',
      path: API.browse,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const path = body === undefined ? '' : stringField(body, 'path')
        try {
          writeJson(res, 200, await browseDirs(path))
        } catch (error) {
          fail(res, error)
        }
      },
    },
  ]
  return routes
}
