/**
 * Gated filesystem operations: the security boundary of the multi-root
 * plugin. Every operation resolves a registered root by id or name, then
 * canonicalizes the target with `fs.realpath` and requires it to live inside
 * that root (separator- and case-robust on Windows). Writes additionally
 * verify the resolved parent directory before creating anything, so a
 * symlinked ancestor cannot smuggle the write outside the root.
 *
 * The operations deliberately bypass the DSH file sandbox (they run with the
 * host process permissions) — the trust boundary is the root set itself:
 * only directories the user attached in the GUI are reachable, and only from
 * within their subtree.
 * @module @luoyu_xingu/dsh-multi-root/fs-ops
 */

import fg from 'fast-glob'
import { existsSync } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { BrowseDir, BrowseResult, DirEntryView, RootEntry, RootView } from './core/types.ts'
import { MAX_GLOB_MATCHES, MAX_LIST_ENTRIES, MAX_READ_BYTES, MAX_WRITE_BYTES } from './invariant.ts'
import type { MultiRootStore } from './store.ts'

/** Structured failure shared by every operation. */
export class FsOpsError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * Normalize a path for prefix comparison: collapse Windows separators to `/`
 * and drop any trailing slash. On win32 the whole path is also lower-cased so
 * a case-insensitive FS cannot trip the membership check.
 */
export function normalizeForPrefix(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** The canonical prefix check: child must live inside (or equal) the root. */
export function isPathInside(root: string, child: string): boolean {
  if (root === '' || child === '') return false
  const normRoot = normalizeForPrefix(root)
  const normChild = normalizeForPrefix(child)
  if (normChild === normRoot) return true
  return normChild.startsWith(`${normRoot}/`)
}

/**
 * Join a root-relative path under a root, rejecting traversal attempts.
 * The path must be relative: absolute paths, drive letters, empty paths, and
 * any `..` segment are refused before they reach the filesystem.
 */
export function joinRel(root: string, rel: string): string {
  if (typeof rel !== 'string' || rel === '') throw new FsOpsError('path-invalid', 'path is empty')
  if (isAbsolute(rel)) throw new FsOpsError('path-invalid', 'path must be relative to the root')
  // A drive-qualified path is a traversal hazard only on Windows; on POSIX
  // `C:foo` is a legal relative filename, so the check must not fire there.
  if (process.platform === 'win32' && /^[a-zA-Z]:/.test(rel)) throw new FsOpsError('path-invalid', 'path must be relative to the root')
  const segments = rel.split(/[\\/]+/)
  if (segments.some(segment => segment === '..')) {
    throw new FsOpsError('path-escape', `path escapes the root: ${rel}`)
  }
  const joined = join(root, ...segments)
  return joined
}

/** Resolve a root reference (exact id first, then exact display name). */
export async function resolveRootRef(store: MultiRootStore, ref: string): Promise<RootEntry> {
  if (typeof ref !== 'string' || ref === '') throw new FsOpsError('root-unknown', 'root reference is empty')
  const roots = await store.list()
  const entry = roots.find(root => root.id === ref) ?? roots.find(root => root.name === ref)
  if (entry === undefined) {
    throw new FsOpsError('root-unknown', `no attached root matches "${ref}" (use workspace_roots to list them)`)
  }
  return entry
}

/** Live status of one root directory. */
export async function rootStatus(path: string): Promise<'ok' | 'missing'> {
  try {
    const info = await stat(path)
    return info.isDirectory() ? 'ok' : 'missing'
  } catch {
    return 'missing'
  }
}

/** The GUI/model view of one root (record + live status). */
export async function toRootView(entry: RootEntry): Promise<RootView> {
  return { ...entry, status: await rootStatus(entry.path) }
}

/**
 * Validate and canonicalize a candidate root path for attachment: the
 * directory must exist (any drive, any location — roots are global and all
 * equal, there is no primary workspace to conflict with).
 * @returns the canonical path and the default display name.
 */
export async function canonicalizeRootPath(path: string): Promise<{ path: string; name: string }> {
  if (typeof path !== 'string' || path === '') throw new FsOpsError('path-invalid', 'root path is empty')
  let canonical: string
  try {
    canonical = await realpath(path)
  } catch {
    throw new FsOpsError('path-invalid', 'path does not resolve on disk')
  }
  try {
    const info = await stat(canonical)
    if (!info.isDirectory()) throw new FsOpsError('path-invalid', 'path is not a directory')
  } catch (error) {
    if (error instanceof FsOpsError) throw error
    throw new FsOpsError('path-invalid', 'path does not resolve on disk')
  }
  return { path: canonical, name: basename(canonical) || canonical }
}

/**
 * Canonicalize the root itself before any containment comparison: on
 * Windows, callers may spell the root with 8.3 short names (`PANYUE~1`)
 * while `realpath` yields the long form, so both sides of every prefix
 * check must share one canonical spelling or legitimate paths read as
 * escapes.
 */
async function canonicalRootOf(root: string): Promise<string> {
  try {
    return await realpath(root)
  } catch {
    throw new FsOpsError('path-invalid', 'root does not resolve on disk')
  }
}

/**
 * Canonicalize a target and require it inside the (already canonical) root.
 * The realpath check is what makes symlinked escapes impossible: a symlink
 * pointing outside the root resolves outside it and is rejected here.
 */
async function canonicalInside(canonicalRoot: string, target: string): Promise<string> {
  let canonical: string
  try {
    canonical = await realpath(target)
  } catch {
    throw new FsOpsError('path-invalid', 'path does not resolve on disk')
  }
  if (!isPathInside(canonicalRoot, canonical)) throw new FsOpsError('path-escape', 'path escapes the registered root')
  return canonical
}

/** Read one text file inside a root (size-capped; oversized files are truncated). */
export async function readTextFile(root: string, rel: string): Promise<{ content: string; size: number; truncated: boolean }> {
  const canonicalRoot = await canonicalRootOf(root)
  const canonical = await canonicalInside(canonicalRoot, joinRel(root, rel))
  const info = await stat(canonical)
  if (!info.isFile()) throw new FsOpsError('path-invalid', 'path is not a file')
  const handle = await open(canonical, 'r')
  try {
    const buffer = Buffer.alloc(MAX_READ_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, MAX_READ_BYTES + 1, 0)
    const truncated = bytesRead > MAX_READ_BYTES
    const content = buffer.subarray(0, Math.min(bytesRead, MAX_READ_BYTES)).toString('utf8')
    return { content, size: info.size, truncated }
  } finally {
    await handle.close()
  }
}

/**
 * Write one text file inside a root. Parent directories are created, but the
 * resolved parent is verified inside the root first (symlink-escape guard),
 * and an existing target is realpath-verified as well so a symlinked file
 * cannot redirect the write outside the root.
 */
export async function writeTextFile(root: string, rel: string, content: string): Promise<{ bytes: number }> {
  if (typeof content !== 'string') throw new FsOpsError('path-invalid', 'content must be text')
  if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
    throw new FsOpsError('content-too-large', `content exceeds the ${MAX_WRITE_BYTES} byte cap`)
  }
  const canonicalRoot = await canonicalRootOf(root)
  const target = joinRel(root, rel)
  const parent = dirname(target)
  try {
    await mkdir(parent, { recursive: true })
  } catch (error) {
    // A dangling-symlink ancestor or a read-only parent surfaces here;
    // fold it into the structured error shape instead of a raw ENOENT/EACCES.
    throw new FsOpsError('path-invalid', error instanceof Error ? error.message : String(error))
  }
  let canonicalParent: string
  try {
    canonicalParent = await realpath(parent)
  } catch {
    throw new FsOpsError('path-invalid', 'parent directory does not resolve on disk')
  }
  if (!isPathInside(canonicalRoot, canonicalParent)) throw new FsOpsError('path-escape', 'path escapes the registered root')
  try {
    // An existing target that is a symlink must still land inside the root.
    const existing = await realpath(target)
    if (!isPathInside(canonicalRoot, existing)) throw new FsOpsError('path-escape', 'path escapes the registered root')
  } catch (error) {
    if (error instanceof FsOpsError) throw error
    // ENOENT: the target does not exist yet; the verified parent is the guard.
  }
  await writeFile(target, content, 'utf8')
  return { bytes: Buffer.byteLength(content, 'utf8') }
}

/** List one directory inside a root (dirs first, count-capped). */
export async function listDir(root: string, rel: string): Promise<{ entries: DirEntryView[]; truncated: boolean }> {
  const canonicalRoot = await canonicalRootOf(root)
  const canonical = await canonicalInside(canonicalRoot, joinRel(root, rel))
  const info = await stat(canonical)
  if (!info.isDirectory()) throw new FsOpsError('path-invalid', 'path is not a directory')
  const dirents = await readdir(canonical, { withFileTypes: true })
  const rows: Array<{ name: string; kind: DirEntryView['kind']; size: number }> = []
  for (const dirent of dirents.slice(0, MAX_LIST_ENTRIES)) {
    const kind: DirEntryView['kind'] = dirent.isDirectory() ? 'directory' : dirent.isFile() ? 'file' : 'other'
    let size = 0
    if (kind === 'file') {
      try {
        size = (await lstat(join(canonical, dirent.name))).size
      } catch {
        size = 0
      }
    }
    rows.push({ name: dirent.name, kind, size })
  }
  rows.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
  return { entries: rows, truncated: dirents.length > MAX_LIST_ENTRIES }
}

/**
 * Glob inside a root. Patterns must be root-relative and traversal-free;
 * symlinks are never followed, and the read/write gates re-verify anything a
 * match is later used for. Results are count-capped.
 */
export async function globInRoot(root: string, pattern: string, maxResults: number = MAX_GLOB_MATCHES): Promise<{ matches: string[]; truncated: boolean }> {
  if (typeof pattern !== 'string' || pattern === '') throw new FsOpsError('path-invalid', 'pattern is empty')
  if (isAbsolute(pattern)) throw new FsOpsError('path-invalid', 'pattern must be relative to the root')
  if (process.platform === 'win32' && /^[a-zA-Z]:/.test(pattern)) throw new FsOpsError('path-invalid', 'pattern must be relative to the root')
  const segments = pattern.split(/[\\/]+/)
  if (segments.some(segment => segment === '..')) throw new FsOpsError('path-escape', `pattern escapes the root: ${pattern}`)
  // fast-glob treats `\` as an escape character on POSIX but as a path
  // separator on Windows; normalize it so both platforms agree (users often
  // paste Windows-style patterns from docs or tool output).
  const normalized = pattern.replaceAll('\\', '/')
  const limit = Number.isInteger(maxResults) && maxResults > 0 ? Math.min(maxResults, MAX_GLOB_MATCHES) : MAX_GLOB_MATCHES
  const matches = await fg(normalized, {
    cwd: root,
    followSymbolicLinks: false,
    onlyFiles: false,
    unique: true,
    dot: true,
  })
  return { matches: matches.slice(0, limit), truncated: matches.length > limit }
}

/**
 * List the directories of one path (the GUI picker feed) plus the drive
 * roster. An empty path opens at the drive level on Windows (so the user
 * picks a drive instead of silently defaulting to the first one) and lists
 * the home directory elsewhere. The response carries the host path
 * separator so the browser half never has to guess it (a backslash is a
 * legal filename character on POSIX systems).
 */
export async function browseDirs(path?: string): Promise<BrowseResult> {
  const drives = listDrives()
  const separator: BrowseResult['separator'] = process.platform === 'win32' ? '\\' : '/'
  if (typeof path !== 'string' || path === '') {
    if (drives.length > 0) return { path: '', dirs: drives, drives, separator }
    return browsePath(homeBase(), drives, separator)
  }
  return browsePath(path, drives, separator)
}

/** List one directory path's subdirectories (never throws; degrades to an empty listing). */
async function browsePath(base: string, drives: BrowseDir[], separator: BrowseResult['separator']): Promise<BrowseResult> {
  try {
    const info = await stat(base)
    if (!info.isDirectory()) return { path: base, dirs: [], drives, separator }
  } catch {
    return { path: base, dirs: [], drives, separator }
  }
  try {
    const dirents = await readdir(base, { withFileTypes: true })
    const dirs: BrowseDir[] = dirents
      .filter(dirent => dirent.isDirectory())
      .map(dirent => ({ name: dirent.name, path: join(base, dirent.name) }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    return { path: base, dirs, drives, separator }
  } catch {
    return { path: base, dirs: [], drives, separator }
  }
}

/** Every existing drive letter on Windows (the picker's top level). */
function listDrives(): BrowseDir[] {
  if (process.platform !== 'win32') return []
  return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    .filter(letter => existsSync(`${letter}:\\`))
    .map(letter => ({ name: `${letter}:`, path: `${letter}:\\` }))
}

/** The picker's starting point on non-Windows platforms: the home directory. */
function homeBase(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE
  return home !== undefined && home !== '' ? home : resolve('/')
}
