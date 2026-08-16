/**
 * Shared type vocabulary of the multi-root plugin: the root-entry records
 * both halves exchange and the operation views the routes/tools produce.
 * Types only — this file carries no runtime code, so it is safe to compile
 * into both the host and the client program.
 * @module @luoyu_xingu/dsh-multi-root/core
 */

/** One attached root: a stable id, a display name, and the canonical directory path. */
export interface RootEntry {
  /** Stable record id (a generated uuid; never rewritten afterwards). */
  readonly id: string
  /** Display alias; defaults to `basename(path)` at add time. */
  readonly name: string
  /** Canonical absolute path: the `fs.realpath` of the path given at add time. */
  readonly path: string
  /** Epoch milliseconds of creation. */
  readonly createdAt: number
  /** Epoch milliseconds of the last durable mutation (create counts as one). */
  readonly updatedAt: number
}

/** One root as presented to the GUI and the model, with its live directory status. */
export interface RootView extends RootEntry {
  /** Whether the directory currently exists on disk (`ok`) or is temporarily missing. */
  readonly status: 'ok' | 'missing'
}

/** One directory-listing entry. */
export interface DirEntryView {
  readonly name: string
  readonly kind: 'file' | 'directory' | 'other'
  /** File size in bytes (`0` for directories and other kinds). */
  readonly size: number
}

/** One browsable directory row for the GUI picker. */
export interface BrowseDir {
  readonly name: string
  readonly path: string
}

/** One directory browse response: the picker feed, the drive roster, and the host separator. */
export interface BrowseResult {
  readonly path: string
  readonly dirs: readonly BrowseDir[]
  readonly drives: readonly BrowseDir[]
  /** The host path separator; the client uses it to compute the Up parent. */
  readonly separator: '/' | '\\'
}
